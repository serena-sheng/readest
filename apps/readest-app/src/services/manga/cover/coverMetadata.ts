/**
 * Reads structured metadata off one manga cover with a single vision request.
 *
 * The cover is the only page whose fields (title, artist, circle, parody,
 * language, tags) are worth a full model round-trip at import time, so this
 * module is deliberately narrower than `translateMangaPage`: one prompt, one
 * JSON object, no cache. Import must never fail because a model was slow or
 * answered prose, so every failure — no endpoint, timeout, HTTP error, bad
 * JSON — resolves to `null` instead of throwing.
 *
 * Requests are gated to two in flight and 300 ms apart per endpoint, because
 * a folder drop can queue dozens of archives against the same provider.
 */

import { getMangaEndpoint } from '@/services/translators/endpoints';

export interface CoverFields {
  title: string;
  artist: string;
  circle: string;
  parody: string;
  language: string;
  tags: string[];
}

/** The subset of a translation endpoint a cover request needs. */
export interface CoverEndpoint {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** The fixed prompt: the model answers one JSON object and nothing else. */
export const COVER_PROMPT = `你是漫画封面信息提取器。看这张封面，只输出一个 JSON 对象，不要解释、不要代码块：
{"title":"作品标题（原文语言，没有则留空）","artist":"画师/作者","circle":"社团/同人组","parody":"原作/系列（原创则填 original）","language":"封面主要语言，用 english/japanese/chinese/korean 之一","tags":["最多 8 个最能描述内容的标签，小写英文"]}
规则：看不清的字段留空字符串；不要臆测；不要把出版社/印刷信息当标题。`;

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_CONCURRENT_REQUESTS = 2;
const MIN_REQUEST_GAP_MS = 300;
const MAX_BASE64_CHUNK = 0x8000;
const MAX_TAGS = 8;

const LANGUAGE_ALIASES: Record<string, string> = {
  en: 'english',
  eng: 'english',
  ja: 'japanese',
  jp: 'japanese',
  zh: 'chinese',
  cn: 'chinese',
  ko: 'korean',
  kr: 'korean',
};

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** A cover is user content: plaintext is only acceptable to this machine. */
const isSecureEndpoint = (baseUrl: string): boolean => {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    if (protocol === 'https:') return true;
    const loopback =
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    return protocol === 'http:' && loopback;
  } catch {
    return false;
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += MAX_BASE64_CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + MAX_BASE64_CHUNK)));
  }
  return btoa(chunks.join(''));
};

const stringField = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeLanguage = (value: unknown): string => {
  const language = stringField(value).toLowerCase();
  return LANGUAGE_ALIASES[language] ?? language;
};

/**
 * Extracts the first JSON object from a model reply, tolerating a ```json
 * fence and prose around it. Returns `null` when nothing parses.
 */
export const parseCoverFields = (raw: unknown): CoverFields | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.trim();
  const candidates: string[] = [text];
  const fenced = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]?.trim()) candidates.push(fenced[1]!.trim());
  const braced = /\{[\s\S]*\}/.exec(text);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const fields: CoverFields = {
      title: stringField(record['title']),
      artist: stringField(record['artist']),
      circle: stringField(record['circle']),
      parody: stringField(record['parody']),
      language: normalizeLanguage(record['language']),
      tags: [],
    };

    const seen = new Set<string>();
    const tags = Array.isArray(record['tags']) ? record['tags'] : [];
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      const value = tag.trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      fields.tags.push(value);
      if (fields.tags.length >= MAX_TAGS) break;
    }
    return fields;
  }

  return null;
};

// --- Request gating -------------------------------------------------------

let activeRequests = 0;
const slotWaiters: Array<() => void> = [];

const acquireSlot = async (): Promise<void> => {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => slotWaiters.push(resolve));
  activeRequests += 1;
};

const lastRequestAt = new Map<string, number>();
const endpointGates = new Map<string, Promise<void>>();

/** Serializes requests to one endpoint so their starts are `MIN_REQUEST_GAP_MS` apart. */
const waitForGap = (key: string): Promise<void> => {
  const previous = endpointGates.get(key) ?? Promise.resolve();
  const gate = previous.then(async () => {
    const wait = (lastRequestAt.get(key) ?? 0) + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    lastRequestAt.set(key, Date.now());
  });
  endpointGates.set(
    key,
    gate.catch(() => undefined),
  );
  return gate;
};

const requestCover = async (
  bytes: Uint8Array,
  mimeType: string,
  endpoint: CoverEndpoint,
  signal: AbortSignal | undefined,
): Promise<CoverFields | null> => {
  const baseUrl = endpoint.baseUrl.trim().replace(/\/+$/, '');
  const model = endpoint.model.trim();
  if (!baseUrl || !model || !isSecureEndpoint(baseUrl)) return null;

  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = endpoint.apiKey?.trim();
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: COVER_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${toBase64(bytes)}` },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const content = payload?.choices?.[0]?.message?.content;
    return parseCoverFields(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
};

/**
 * Sends one cover to the configured vision model.
 *
 * `endpoint` defaults to {@link getMangaEndpoint}; an explicit `null` (or an
 * unconfigured endpoint) returns `null` without a request.
 */
export async function extractCoverFields(args: {
  image: Blob | Uint8Array;
  mimeType: string;
  endpoint?: CoverEndpoint | null;
  signal?: AbortSignal;
}): Promise<CoverFields | null> {
  try {
    const endpoint = args.endpoint === undefined ? getMangaEndpoint() : args.endpoint;
    if (!endpoint?.baseUrl?.trim() || !endpoint.model?.trim()) return null;
    if (args.signal?.aborted) return null;

    const bytes =
      args.image instanceof Uint8Array
        ? args.image
        : new Uint8Array(await args.image.arrayBuffer());
    if (bytes.byteLength === 0) return null;

    const mimeType = args.mimeType.trim() || 'image/jpeg';
    const key = endpoint.baseUrl.trim().replace(/\/+$/, '');

    await acquireSlot();
    try {
      await waitForGap(key);
      return await requestCover(bytes, mimeType, endpoint, args.signal);
    } finally {
      activeRequests -= 1;
      slotWaiters.shift()?.();
    }
  } catch {
    // Import enrichment never propagates a failure.
    return null;
  }
}
