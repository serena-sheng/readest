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

/**
 * The portrait prompt in `visionPrompt.ts` translates into Simplified
 * Chinese, so the cache scopes entries to that target explicitly instead of
 * relying on an implicit default.
 */
export const MANGA_TARGET_LANG = 'zh-Hans';
