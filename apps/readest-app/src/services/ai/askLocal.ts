/**
 * Client for the local "ask the book" service.
 *
 * The service is a small loopback HTTP server; it speaks Server-Sent Events on
 * `/ask` and plain JSON on `/suggest`. Nothing here goes through Readest's own
 * AI providers: no account, no quota, no API key.
 */

export const LOCAL_AI_BASE_URL = 'http://127.0.0.1:8790';

export interface AskLocalOptions {
  question: string;
  selection: string;
  title: string;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

export interface AskSuggestion {
  question: string;
  label: string;
}

interface AskEvent {
  delta?: string;
  done?: boolean;
  error?: string;
}

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const localError = (error: unknown) =>
  new Error(`local-ai: ${error instanceof Error ? error.message : String(error)}`);

/** Parse one SSE event block. Returns null for comment/keep-alive blocks. */
const parseEvent = (block: string): AskEvent | null => {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data.trim()) return null;

  try {
    return JSON.parse(data) as AskEvent;
  } catch {
    throw new Error('local-ai: invalid stream data');
  }
};

/**
 * POST a question and stream the answer through `onDelta`.
 *
 * Resolves when the service sends `{"done":true}`; rejects with a `local-ai:`
 * error for a network failure, a non-2xx response, or an `{"error":...}` event.
 * Aborts are rethrown unchanged so callers can tell them from real failures.
 */
export const askLocal = async ({
  question,
  selection,
  title,
  signal,
  onDelta,
}: AskLocalOptions): Promise<void> => {
  let response: Response;
  try {
    response = await window.fetch(`${LOCAL_AI_BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, selection, title }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw localError(error);
  }

  if (!response.ok) {
    throw new Error(`local-ai: ask failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('local-ai: empty response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const handleBlock = (block: string) => {
    const event = parseEvent(block);
    if (!event) return;

    if (event.error) {
      throw new Error(`local-ai: ${event.error}`);
    }
    if (typeof event.delta === 'string') {
      onDelta(event.delta);
    }
    if (event.done) {
      finished = true;
    }
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleBlock(block);
        if (finished) break;
        boundary = buffer.indexOf('\n\n');
      }
    }

    if (!finished) {
      buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
      if (buffer.trim()) handleBlock(buffer);
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof Error && error.message.startsWith('local-ai:')) throw error;
    throw localError(error);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

/** Fetch up to three question suggestions for the current text. */
export const suggestLocal = async ({
  text,
  title,
}: {
  text: string;
  title: string;
}): Promise<AskSuggestion[]> => {
  let response: Response;
  try {
    response = await window.fetch(`${LOCAL_AI_BASE_URL}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
  } catch (error) {
    throw localError(error);
  }

  if (!response.ok) {
    throw new Error(`local-ai: suggest failed (${response.status})`);
  }

  let data: { suggestions?: unknown };
  try {
    data = (await response.json()) as { suggestions?: unknown };
  } catch (error) {
    throw localError(error);
  }

  if (!Array.isArray(data.suggestions)) return [];

  return data.suggestions
    .filter(
      (item): item is AskSuggestion =>
        !!item && typeof item === 'object' && typeof (item as AskSuggestion).question === 'string',
    )
    .map((item) => ({
      question: item.question,
      label: typeof item.label === 'string' && item.label ? item.label : item.question,
    }));
};
