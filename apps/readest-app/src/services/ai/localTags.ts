/**
 * Client for the local service's tag catalogue (`/library/*` on the same
 * loopback server as the ask-book endpoints).
 *
 * Reads only: the panel built on top of this module browses the tags the
 * service indexed and evaluates a filter expression. Nothing here writes to
 * the library.
 *
 * Every failure — network, non-2xx, malformed payload — is thrown as an
 * `Error` whose message starts with `tags:` so the panel can tell it apart
 * from unrelated failures and show one consistent message.
 */

import { LOCAL_AI_BASE_URL } from './askLocal';

export interface LocalTag {
  namespace: string;
  name: string;
  count: number;
}

/**
 * One book matched by an expression. `tags` carries canonical `namespace:name`
 * strings, which is what the panel counts to show how many terms matched.
 */
export interface LocalTagBook {
  id: number;
  title: string;
  author?: string | null;
  path?: string;
  page_count?: number | null;
  source?: string | null;
  tags: string[];
}

/** Shared transport: network failures and non-2xx responses get the prefix. */
const request = async (path: string): Promise<Response> => {
  let response: Response;
  try {
    response = await window.fetch(`${LOCAL_AI_BASE_URL}${path}`);
  } catch (error) {
    throw new Error(`tags: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`tags: request failed (${response.status})`);
  }
  return response;
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`tags: invalid response (${error instanceof Error ? error.message : String(error)})`);
  }
};

/** Every tag in the catalogue, optionally narrowed to one namespace. */
export const getTags = async (namespace?: string): Promise<LocalTag[]> => {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  const payload = await parseJson(await request(`/library/tags${query}`));
  const tags = (payload as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags)) {
    throw new Error('tags: invalid tags payload');
  }
  return tags as LocalTag[];
};

/**
 * Books matching a filter expression. An empty expression is not a query at
 * all, so it returns `[]` without touching the service.
 */
export const queryBooks = async (expr: string): Promise<LocalTagBook[]> => {
  const trimmed = expr.trim();
  if (!trimmed) return [];
  const payload = await parseJson(
    await request(`/library/query?expr=${encodeURIComponent(trimmed)}`),
  );
  const books = (payload as { books?: unknown } | null)?.books;
  if (!Array.isArray(books)) {
    throw new Error('tags: invalid books payload');
  }
  return books as LocalTagBook[];
};

/** Every book the service knows about, for the unfiltered result list. */
export const listBooks = async (): Promise<LocalTagBook[]> => {
  const payload = await parseJson(await request('/library/books'));
  const books = (payload as { books?: unknown } | null)?.books;
  if (!Array.isArray(books)) {
    throw new Error('tags: invalid books payload');
  }
  return books as LocalTagBook[];
};
