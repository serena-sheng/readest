/**
 * Asks an OpenAI-compatible chat endpoint (DeepSeek by default) to suggest a
 * short, clean Chinese title for each book in the library.
 *
 * Batching is deliberate: one request per 20 books keeps the prompt small
 * enough for the model to answer every item, and requests run one after
 * another so a large library does not burst a rate-limit budget. Any failure
 * (network, HTTP, malformed answer) degrades to the current title for that
 * batch instead of throwing — the caller shows the table and the user decides.
 */

import { getActiveEndpoint } from '@/services/translators/endpoints';

export interface RenameBookInput {
  hash: string;
  title: string;
  author?: string;
  language?: string;
}

export interface RenameCandidate {
  hash: string;
  currentTitle: string;
  suggestedTitle: string;
  reason: string;
}

export interface RenameEndpoint {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export const RENAME_BATCH_SIZE = 20;
export const RENAME_TIMEOUT_MS = 45_000;

export const RENAME_PROMPT = `你是书库整理助手。给你一批书名（可能有日语、罗马音、英语、中文，常夹带作者名、社团、汉化组、语言标记、卷号、标签）。
为每一本给出一个「简短、干净、纯汉语」的书名建议。
规则：
1. 日语/罗马音/英语一律译成汉语；假名与罗马音尽量还原成对应的汉字（有通行译名就用通行译名）。
2. 去掉作者名、社团/同人组、汉化组、语言标记（如 [English]/[中国翻訳]/[中文]）、卷号与话数、平台、分辨率、页数、标签、括号里的说明。
3. 只保留作品名本身，不超过 24 个汉字，不要书名号，不要标点装饰。
4. 无法判断原意时，保留原书名不动。
5. 只输出 JSON 数组，不要解释： [{"i":1,"title":"建议书名","why":"一句话理由"}]`;

const FAILURE_REASON = '未能获取建议';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

const resolveEndpoint = (override?: RenameEndpoint | null): RenameEndpoint | null => {
  if (override === null) return null;
  const endpoint = override ?? getActiveEndpoint();
  const baseUrl = endpoint?.baseUrl?.trim().replace(/\/+$/, '') ?? '';
  const model = endpoint?.model?.trim() ?? '';
  if (!baseUrl || !model) return null;
  const apiKey = endpoint?.apiKey?.trim();
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
};

const conservativeResult = (book: RenameBookInput): RenameCandidate => ({
  hash: book.hash,
  currentTitle: book.title,
  suggestedTitle: book.title,
  reason: FAILURE_REASON,
});

const batchContent = (batch: RenameBookInput[]): string =>
  batch
    .map((book, index) => {
      const details = [
        book.author?.trim() ? `作者：${book.author.trim()}` : '',
        book.language?.trim() ? `语言：${book.language.trim()}` : '',
      ]
        .filter(Boolean)
        .join('；');
      return `${index + 1}. ${book.title}${details ? `（${details}）` : ''}`;
    })
    .join('\n');

const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const text = (part as { text?: unknown } | null)?.text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
};

/**
 * Reads the JSON array out of a model answer that may be wrapped in a
 * ```json fence or surrounded by prose. Items are matched by their 1-based
 * `i`, so a model that drops or reorders entries cannot shift titles onto the
 * wrong books.
 */
const parseBatch = (content: unknown, batch: RenameBookInput[]): RenameCandidate[] => {
  const text = contentToText(content);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('rename suggestions: no JSON array');

  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('rename suggestions: not an array');

  const answers = new Map<number, { title: string; why: string }>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { i?: unknown; title?: unknown; why?: unknown };
    const index = typeof entry.i === 'number' ? Math.trunc(entry.i) : NaN;
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (!Number.isInteger(index) || index < 1 || index > batch.length || !title) continue;
    if (answers.has(index)) continue;
    const why = typeof entry.why === 'string' ? entry.why.trim().slice(0, 60) : '';
    answers.set(index, { title, why });
  }

  return batch.map((book, index) => {
    const answer = answers.get(index + 1);
    return {
      hash: book.hash,
      currentTitle: book.title,
      suggestedTitle: answer?.title ?? book.title,
      reason: answer?.why ?? '',
    };
  });
};

const requestBatch = async (
  endpoint: RenameEndpoint,
  batch: RenameBookInput[],
  signal?: AbortSignal,
): Promise<RenameCandidate[]> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, RENAME_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;

  try {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.3,
        stream: false,
        messages: [
          { role: 'system', content: RENAME_PROMPT },
          { role: 'user', content: batchContent(batch) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`rename suggestions: HTTP ${response.status}`);
    const payload = (await response.json()) as ChatCompletionResponse;
    return parseBatch(payload?.choices?.[0]?.message?.content, batch);
  } catch (error) {
    if (timedOut) throw new Error('rename suggestions: request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
};

export async function suggestBookTitles(
  books: RenameBookInput[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    endpoint?: RenameEndpoint | null;
  } = {},
): Promise<RenameCandidate[]> {
  const { signal, onProgress } = opts;
  if (!books.length) return [];

  const endpoint = resolveEndpoint(opts.endpoint);
  if (!endpoint) return [];

  const results: RenameCandidate[] = [];
  for (let offset = 0; offset < books.length; offset += RENAME_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = books.slice(offset, offset + RENAME_BATCH_SIZE);
    try {
      results.push(...(await requestBatch(endpoint, batch, signal)));
    } catch (error) {
      if (signal?.aborted) break;
      console.warn('Failed to get rename suggestions for a batch:', error);
      results.push(...batch.map(conservativeResult));
    }
    onProgress?.(results.length, books.length);
  }
  return results;
}
