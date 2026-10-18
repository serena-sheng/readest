/**
 * Client for the local service's translation-expert endpoints (`/styles`,
 * `/experts`, `/bind`), plus the single localStorage key the `emm` translator
 * provider reads before every page.
 *
 * The catalog and the saved experts live in the loopback service; the active
 * `<genre>.<mode>` pair does not. It is kept in `localStorage` because the
 * provider reads it per translation call, so writing it from the panel takes
 * effect on the next page without a reload or a store subscription.
 *
 * Every failure is thrown as an `Error` whose message starts with `experts:`
 * so callers can tell it apart from unrelated failures and show one message.
 */

import { LOCAL_AI_BASE_URL } from './askLocal';

/** Must match the key `services/translators/providers/emm.ts` reads. */
export const STYLE_STORAGE_KEY = 'emm.translationStyle';
export const DEFAULT_STYLE = 'humanities.faithful';

export interface TranslationGenre {
  id: string;
  label: string;
  desc: string;
}

export interface TranslationMode {
  id: string;
  label: string;
  desc: string;
  temp?: number;
}

export interface TranslationStyles {
  genres: TranslationGenre[];
  modes: TranslationMode[];
  /** `<genre>.<mode>`, as the service names its own fallback. */
  default: string;
}

export interface TranslationExpert {
  id: number;
  name: string;
  genre: string;
  mode: string;
  glossary_count: number;
  override_prompt: string;
  temp_override: number | null;
}

export interface SaveExpertInput {
  name: string;
  genre: string;
  mode: string;
  /** `原词=译名` lines, parsed by the service. */
  glossary: string;
  override_prompt?: string;
}

export interface SavedExpert {
  id: number;
  name: string;
}

/** Shared transport: network failures and non-2xx responses get the prefix. */
const request = async (path: string, init?: RequestInit): Promise<Response> => {
  let response: Response;
  try {
    response = await window.fetch(`${LOCAL_AI_BASE_URL}${path}`, init);
  } catch (error) {
    throw new Error(`experts: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`experts: request failed (${response.status})`);
  }
  return response;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      `experts: invalid response (${error instanceof Error ? error.message : String(error)})`,
    );
  }
};

/** The genre × mode catalog the panel renders. */
export const getStyles = async (): Promise<TranslationStyles> => {
  const payload = (await readJson(await request('/styles'))) as Partial<TranslationStyles> | null;
  if (!payload || !Array.isArray(payload.genres) || !Array.isArray(payload.modes)) {
    throw new Error('experts: invalid styles payload');
  }
  const fallback =
    typeof payload.default === 'string' && payload.default.includes('.')
      ? payload.default
      : DEFAULT_STYLE;
  return { genres: payload.genres, modes: payload.modes, default: fallback };
};

/** Saved experts, newest first (the service already orders them). */
export const getExperts = async (): Promise<TranslationExpert[]> => {
  const payload = (await readJson(await request('/experts'))) as { experts?: unknown } | null;
  if (!Array.isArray(payload?.experts)) {
    throw new Error('experts: invalid experts payload');
  }
  return payload!.experts as TranslationExpert[];
};

/** Create or overwrite an expert by name; the service returns its id. */
export const saveExpert = async (input: SaveExpertInput): Promise<SavedExpert> => {
  const payload = (await readJson(
    await request('/experts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )) as Partial<SavedExpert> | null;
  if (typeof payload?.id !== 'number' || typeof payload.name !== 'string') {
    throw new Error('experts: invalid expert payload');
  }
  return { id: payload.id, name: payload.name };
};

/**
 * Bind one expert to a book on the service. The book is identified by its
 * title, which is what the reader knows without the library service.
 */
export const bindExpert = async (book: string, expertId: number): Promise<void> => {
  const payload = (await readJson(
    await request('/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book, expert_id: expertId }),
    }),
  )) as { ok?: unknown } | null;
  if (payload?.ok !== true) {
    throw new Error('experts: bind was rejected');
  }
};

/**
 * The style the provider will use next. Storage reads can throw when it is
 * disabled (private windows), in which case the default is as good an answer
 * as the provider's own fallback.
 */
export const getActiveStyle = (): string => {
  try {
    return window.localStorage.getItem(STYLE_STORAGE_KEY)?.trim() || DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
};

/** Write the style the provider reads on its next call. */
export const setActiveStyle = (styleId: string): void => {
  const value = styleId.trim();
  if (!value) throw new Error('experts: empty style id');
  try {
    window.localStorage.setItem(STYLE_STORAGE_KEY, value);
  } catch (error) {
    throw new Error(`experts: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** Split `<genre>.<mode>`, falling back to the default pair. */
export const splitStyleId = (styleId: string): { genre: string; mode: string } => {
  const id = styleId.trim() || DEFAULT_STYLE;
  const [genre, mode] = id.split('.');
  const [fallbackGenre, fallbackMode] = DEFAULT_STYLE.split('.');
  return { genre: genre || fallbackGenre!, mode: mode || fallbackMode! };
};
