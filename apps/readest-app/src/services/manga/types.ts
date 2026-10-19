/** [x1, y1, x2, y2], always top-left to bottom-right. */
export type MangaBox = [number, number, number, number];

/**
 * One detected text region on a manga page.
 *
 * `box` is in pixels of the page the model was shown once `parseVisionResult`
 * has been given bounds; without bounds it stays in the model's normalized
 * 0–1 space. `vertical` records that the source text runs top to bottom,
 * which the renderer needs to lay the translation out the same way.
 */
export interface MangaBubble {
  box: MangaBox;
  src: string;
  dst: string;
  vertical: boolean;
}

export interface MangaPageResult {
  width: number;
  height: number;
  bubbles: MangaBubble[];
}

/** The vision backend a page is sent to; resolved from a translation endpoint. */
export interface MangaVisionEndpoint {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** Targets the vision prompt has a wording for. */
export type MangaTargetLang = 'zh-Hans' | 'en' | 'ja';

/**
 * The default target the visual prompt was originally written for. Kept as a
 * separate constant so the cache still scopes entries when no target is given.
 */
export const MANGA_TARGET_LANG: MangaTargetLang = 'zh-Hans';

/**
 * Maps a reader language tag to one of the prompt wordings. Anything the
 * manga prompt does not specialize (including `zh-Hant`) falls back to the
 * original Simplified Chinese target.
 */
export const normalizeMangaTargetLang = (lang?: string | null): MangaTargetLang => {
  const tag = (lang ?? '').trim().toLowerCase();
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return MANGA_TARGET_LANG;
};
