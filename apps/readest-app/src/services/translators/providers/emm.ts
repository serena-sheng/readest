import { getActiveEndpoint } from '../endpoints';
import { contractFor, systemPromptFor, translateRequest } from '../prompts';
import { TranslationProvider } from '../types';

/**
 * Translation through the endpoint the reader selected (`endpoints.ts`).
 *
 * Two kinds share one batching contract: the local "expert translation"
 * service (`POST {baseUrl}/translate`) and any OpenAI-compatible chat API
 * (`POST {baseUrl}/chat/completions`). Both are sent a whole page at once and
 * both return paragraphs keyed by 1-based request position, so the caller's
 * array is rebuilt from those ids regardless of the response order.
 *
 * Sending more than one request in flight would defeat the batching, hence
 * `concurrency: 1`. The provider is marked `requiresApp` because its default
 * backend is a loopback service that only exists on the machine that runs it.
 */
const STYLE_STORAGE_KEY = 'emm.translationStyle';
const DEFAULT_STYLE = 'humanities.faithful';

interface ServiceParagraph {
  id: number;
  text: string;
  notes?: string[];
}

interface ServiceResponse {
  paragraphs?: ServiceParagraph[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/**
 * The style is a `<genre>.<mode>` pair understood by the local service and by
 * the ported prompts, e.g. `humanities.faithful`. It is read per call rather
 * than at module load so a change in the UI takes effect on the next
 * translated page without a reload. Storage can throw when disabled (private
 * windows), in which case we fall back to the default instead of failing.
 */
const readStyle = (): string => {
  try {
    return window.localStorage.getItem(STYLE_STORAGE_KEY)?.trim() || DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
};

const CURRENT_BOOK_KEY = 'emm.currentBook';

/** The book the reader currently has open, published by the reader chrome. */
const readCurrentBook = (): string => {
  try {
    return window.localStorage?.getItem(CURRENT_BOOK_KEY) ?? '';
  } catch {
    return '';
  }
};

const fail: (detail: string) => never = (detail) => {
  throw new Error(`emm: ${detail}`);
};

const postJson = async (
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
): Promise<Response> => {
  const fetch = window.fetch.bind(window);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  }).catch((error: unknown) => {
    // An abort is the caller's decision, not a service failure; the batch
    // translator treats it differently from a real error.
    if ((error as Error | undefined)?.name === 'AbortError') throw error;
    return fail(`翻译端点不可用（${url}）`);
  });
  if (!response.ok) fail(`HTTP ${response.status}`);
  return response;
};

/** `choices[0].message.content`, which may be fenced ```json by some models. */
const parseChatContent = (content: unknown): unknown => {
  if (typeof content !== 'string' || !content.trim()) fail('模型响应为空');
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const payload = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    return fail('模型响应不是合法 JSON');
  }
};

/**
 * Rebuild the caller's array from ids. Ids are 1-based positions in the
 * request; looking them up (instead of trusting response order) is what makes
 * a shuffled response safe.
 */
const alignParagraphs = (
  texts: string[],
  requestIndices: number[],
  paragraphs: unknown,
): string[] => {
  if (!Array.isArray(paragraphs)) fail('响应缺少 paragraphs 数组');
  const byId = new Map<number, string>();
  for (const paragraph of paragraphs as Array<Partial<ServiceParagraph> | null>) {
    if (typeof paragraph?.id !== 'number' || typeof paragraph?.text !== 'string') {
      fail('响应段落结构不符');
    }
    if (byId.has(paragraph.id)) fail(`响应中 id ${paragraph.id} 重复`);
    byId.set(paragraph.id, paragraph.text);
  }

  const results = [...texts];
  requestIndices.forEach((textIndex, requestIndex) => {
    const id = requestIndex + 1;
    const translated = byId.get(id);
    if (translated === undefined) fail(`响应缺少第 ${id} 段`);
    results[textIndex] = translated;
  });
  return results;
};

export const emmProvider: TranslationProvider = {
  name: 'emm',
  label: '本地专家（本机服务）',
  requiresApp: true,
  concurrency: 1,
  /**
   * `targetLang` is deliberately ignored: both kinds render into the language
   * of the service's own LANG_LINE (Chinese today). Calling with a non-Chinese
   * target yields Chinese text rather than an error — this is a local
   * experiment, not a general-purpose translator.
   */
  translate: async (
    texts: string[],
    _sourceLang: string,
    _targetLang: string,
    _token?: string | null,
    _useCache?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!texts.length) return [];

    // Blank paragraphs carry no meaning; keeping them out of the request costs
    // no work and they are restored verbatim below, so the caller's array
    // keeps its length and order.
    const requestIndices = texts
      .map((_, index) => index)
      .filter((index) => texts[index]!.trim().length > 0);
    if (!requestIndices.length) return [...texts];

    const endpoint = getActiveEndpoint();
    const baseUrl = endpoint.baseUrl.trim().replace(/\/+$/, '');
    const requestTexts = requestIndices.map((index) => texts[index]!);

    if (endpoint.kind === 'openai-compatible') {
      const model = endpoint.model?.trim();
      if (!model) fail('端点未配置模型');
      const url = `${baseUrl}/chat/completions`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (endpoint.apiKey?.trim()) {
        // The key travels in the header only; it is never logged or stored in
        // the request body.
        headers['Authorization'] = `Bearer ${endpoint.apiKey.trim()}`;
      }
      const style = readStyle();
      const response = await postJson(
        url,
        {
          model,
          temperature: 0.4,
          stream: false,
          messages: [
            { role: 'system', content: systemPromptFor(style) },
            { role: 'user', content: translateRequest(requestTexts, '简体中文', contractFor(style)) },
          ],
        },
        signal,
        headers,
      );
      const payload: ChatCompletionResponse | undefined = await response
        .json()
        .catch(() => fail('响应不是合法 JSON'));
      const content = payload?.choices?.[0]?.message?.content;
      const parsed = parseChatContent(content) as ServiceResponse | null;
      return alignParagraphs(texts, requestIndices, parsed?.paragraphs);
    }

    const url = `${baseUrl}/translate`;
    const response = await postJson(
      url,
      {
        style: readStyle(),
        // The book title lets the service apply a per-book expert binding; it
        // is absent in tests and in the web build, where the service ignores
        // it.
        book: readCurrentBook(),
        paragraphs: requestTexts,
      },
      signal,
    );

    const raw: ServiceResponse | undefined = await response
      .json()
      .catch(() => fail('响应不是合法 JSON'));
    return alignParagraphs(texts, requestIndices, raw?.paragraphs);
  },
};
