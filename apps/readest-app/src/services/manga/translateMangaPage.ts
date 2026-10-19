/**
 * Translates one manga page end to end: image bytes in, positioned bubbles out.
 *
 * The image is sent as a data URL to an OpenAI-compatible vision endpoint
 * (the same `{baseUrl}/chat/completions` shape the text translator uses), so
 * the provider keeps one credential while the reader configures a separate
 * vision model. Results are cached by image content and configuration; a hit
 * returns before any network call.
 *
 * Page images are user content and the endpoint may be remote, so plaintext
 * HTTP is only accepted for a loopback address. Anything else must be HTTPS.
 */

import { hashBytes } from './imageHash';
import { getMangaPage, glossaryRevision, makeMangaCacheKey, setMangaPage } from './mangaCache';
import { MANGA_TARGET_LANG, type MangaPageResult, type MangaVisionEndpoint } from './types';
import { buildVisionPrompt, parseVisionResult } from './visionPrompt';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_BASE64_CHUNK = 0x8000;
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

const fail = (detail: string): never => {
  throw new Error(`manga: ${detail}`);
};

const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/** Refuses to send a page image over plaintext to anything but this machine. */
const ensureSecureEndpoint = (baseUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return fail('端点地址无效');
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && isLoopback(parsed.hostname)) return;
  fail('不允许把图片发送到明文地址');
};

const toBase64 = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += MAX_BASE64_CHUNK) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(index, index + MAX_BASE64_CHUNK)),
    );
  }
  return btoa(chunks.join(''));
};

export async function translateMangaPage(args: {
  image: Blob | ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
  endpoint: MangaVisionEndpoint;
  glossary?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<MangaPageResult> {
  const { image, mimeType, width, height, endpoint, glossary, signal } = args;

  if (!(width > 0) || !(height > 0)) fail('页面尺寸无效');
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) fail(`不支持的图片类型（${mimeType}）`);

  const baseUrl = endpoint.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) fail('端点地址无效');
  const model = endpoint.model.trim();
  if (!model) fail('未配置视觉模型');
  ensureSecureEndpoint(baseUrl);

  let bytes: Uint8Array;
  if (image instanceof ArrayBuffer) {
    bytes = new Uint8Array(image);
  } else {
    try {
      bytes = new Uint8Array(await image.arrayBuffer());
    } catch {
      return fail('图片读取失败');
    }
  }

  const cacheKey = makeMangaCacheKey(
    hashBytes(bytes),
    model,
    MANGA_TARGET_LANG,
    glossaryRevision(glossary),
  );
  const cached = await getMangaPage(cacheKey);
  if (cached) return cached;

  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (endpoint.apiKey?.trim()) {
    // The key travels in the header only; it is never part of the body or a
    // cache key.
    headers['Authorization'] = `Bearer ${endpoint.apiKey.trim()}`;
  }
  const dataUrl = `data:${mimeType};base64,${toBase64(bytes)}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  const postPage = async (): Promise<Response> => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildVisionPrompt({ glossary }) },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) return fail('请求超时（60 秒）');
      // An abort is the caller's decision, not a service failure.
      if ((error as Error | undefined)?.name === 'AbortError' || signal?.aborted) {
        return fail('请求已取消');
      }
      return fail(`视觉端点不可用（${url}）`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  };

  const response = await postPage();
  if (!response.ok) fail(`HTTP ${response.status}`);

  const payload = (await response
    .json()
    .catch(() => fail('响应不是合法 JSON'))) as ChatCompletionResponse | undefined;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) fail('模型响应为空');

  const result: MangaPageResult = {
    width,
    height,
    bubbles: parseVisionResult(content, { width, height }),
  };
  await setMangaPage(cacheKey, result);
  return result;
}
