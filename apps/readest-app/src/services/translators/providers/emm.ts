import { TranslationProvider } from '../types';

/**
 * Bridge to the local "expert translation" service (the Python server behind
 * the Common Reader prototype). Unlike every other provider here it talks to a
 * loopback HTTP endpoint, which only exists on the machine that runs it — so
 * the provider is marked `requiresApp` to keep it out of the supported web
 * configuration. (That flag is informational for built-ins today; only custom
 * translators are disabled by it.)
 *
 * The service batches a whole page in one request, and its own ordering is an
 * implementation detail: every returned paragraph carries an `id`, and the
 * caller's array is rebuilt from those ids. Sending more than one request in
 * flight would defeat the batching, hence `concurrency: 1`.
 */
const SERVICE_URL = 'http://127.0.0.1:8790/translate';
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

/**
 * The style is a `<genre>.<mode>` pair understood by the service, e.g.
 * `humanities.faithful`. It is read per call rather than at module load so a
 * change in the UI takes effect on the next translated page without a reload.
 * Storage can throw when disabled (private windows), in which case we fall
 * back to the default instead of failing the translation.
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

export const emmProvider: TranslationProvider = {
  name: 'emm',
  label: '本地专家（本机服务）',
  requiresApp: true,
  concurrency: 1,
  /**
   * `targetLang` is deliberately ignored: the service always renders into the
   * language of its own LANG_LINE (Chinese today). Calling it anyway with a
   * non-Chinese target yields Chinese text rather than an error — this is a
   * local experiment, not a general-purpose translator.
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
    // no service work and they are restored verbatim below, so the caller's
    // array keeps its length and order.
    const requestIndices = texts
      .map((_, index) => index)
      .filter((index) => texts[index]!.trim().length > 0);
    if (!requestIndices.length) return [...texts];

    const fetch = window.fetch.bind(window);

    const response = await fetch(SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style: readStyle(),
        // The book title lets the service apply a per-book expert binding; it is
        // absent in tests and in the web build, where the service ignores it.
        book: readCurrentBook(),
        paragraphs: requestIndices.map((index) => texts[index]),
      }),
      signal,
    }).catch((error: unknown) => {
      // An abort is the caller's decision, not a service failure; the batch
      // translator treats it differently from a real error.
      if ((error as Error | undefined)?.name === 'AbortError') throw error;
      return fail(`本地服务不可用（${SERVICE_URL}）`);
    });

    if (!response.ok) fail(`HTTP ${response.status}`);

    const raw: ServiceResponse | undefined = await response
      .json()
      .catch(() => fail('响应不是合法 JSON'));

    const paragraphs = raw?.paragraphs;
    if (!Array.isArray(paragraphs)) fail('响应缺少 paragraphs 数组');

    const byId = new Map<number, string>();
    for (const paragraph of paragraphs) {
      if (typeof paragraph?.id !== 'number' || typeof paragraph?.text !== 'string') {
        fail('响应段落结构不符');
      }
      if (byId.has(paragraph!.id)) fail(`响应中 id ${paragraph!.id} 重复`);
      byId.set(paragraph!.id, paragraph!.text);
    }

    const results = [...texts];
    requestIndices.forEach((textIndex, requestIndex) => {
      // Ids are 1-based positions in the request. Looking them up (instead of
      // trusting the response order) is what makes a shuffled response safe.
      const id = requestIndex + 1;
      const translated = byId.get(id);
      if (translated === undefined) fail(`响应缺少第 ${id} 段`);
      results[textIndex] = translated;
    });

    return results;
  },
};
