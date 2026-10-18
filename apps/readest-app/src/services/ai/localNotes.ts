/**
 * Client for the local service's note store (`/notes` on the same loopback
 * server as the ask-book endpoints). Notes are keyed by book title, which is
 * what the reader knows without asking the library service for an id.
 *
 * Every failure — network, non-2xx, malformed payload — is thrown as an
 * `Error` whose message starts with `local-notes:` so callers can tell it
 * apart from unrelated failures and surface one consistent message.
 */

import { LOCAL_AI_BASE_URL } from './askLocal';

export interface LocalNote {
  id: number;
  uuid: string;
  quote: string;
  note: string;
  locator: string;
  /** Unix seconds as written by the service; ISO strings are accepted too. */
  created_at: number | string;
}

export interface SaveNoteInput {
  book: string;
  quote: string;
  note: string;
  locator: string;
}

/** Shared transport: network failures and non-2xx responses get the prefix. */
const request = async (path: string, init?: RequestInit): Promise<Response> => {
  let response: Response;
  try {
    response = await window.fetch(`${LOCAL_AI_BASE_URL}${path}`, init);
  } catch (error) {
    throw new Error(`local-notes: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`local-notes: request failed (${response.status})`);
  }
  return response;
};

/** Notes for one book, newest first (the service already orders them). */
export const listNotes = async (book: string): Promise<LocalNote[]> => {
  const response = await request(`/notes?book=${encodeURIComponent(book)}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `local-notes: invalid response (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const notes = (payload as { notes?: unknown } | null)?.notes;
  if (!Array.isArray(notes)) {
    throw new Error('local-notes: invalid notes payload');
  }
  return notes as LocalNote[];
};

/**
 * Record one idea. The created `{id, uuid}` is deliberately not parsed: no
 * caller consumes it, and the service's success status is the contract that
 * matters here.
 */
export const saveNote = async (input: SaveNoteInput): Promise<void> => {
  await request('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
};

/** Remove one idea by its stable uuid. */
export const deleteNote = async (uuid: string): Promise<void> => {
  await request(`/notes?uuid=${encodeURIComponent(uuid)}`, { method: 'DELETE' });
};
