/**
 * Comic (CBZ) pages are app-rendered bitmaps, so they sit on a stage painted
 * by the reader rather than by the book. The stage paints the theme's own page
 * color — not a fixed slab — so the page reads as paper inside the reader
 * instead of a separate window. Dark themes paint their own page color too:
 * the point is that the stage fills the whole cell and gives the page a margin,
 * which fixes the paper bands around a dark slab in both directions.
 */
export const COMIC_STAGE_PADDING = 24;
export const COMIC_STAGE_STYLE_ID = 'comic-stage-theme';
export const COMIC_STAGE_HTML_CLASS = 'comic-stage-themed';

export interface ComicStageTheme {
  /** Page background painted behind the comic page. */
  background: string;
  /** Breathing room between the page and the stage edges, in px. */
  padding: number;
}

/**
 * The stage for a comic in the current theme, or null when the theme exposes no
 * page color (nothing to paint with).
 *
 * `isDarkMode` is accepted for callers that want to vary the padding later; the
 * background always comes from the theme itself, so a dark theme paints its own
 * dark page color rather than being skipped.
 */
export const getComicStageTheme = ({
  pageBackground,
}: {
  isDarkMode?: boolean;
  pageBackground?: string | null;
}): ComicStageTheme | null => {
  const background = pageBackground?.trim();
  if (!background) return null;
  return { background, padding: COMIC_STAGE_PADDING };
};

/**
 * Inject (or clear, with a null theme) the comic stage into a page document.
 * Returns a cleanup that removes the injected style and class, restoring the
 * document exactly as it was before.
 */
export const applyComicStageTheme = (
  doc: Document,
  theme: ComicStageTheme | null,
): (() => void) => {
  const root = doc.documentElement;
  const existing = doc.getElementById(COMIC_STAGE_STYLE_ID);
  existing?.remove();
  root.classList.remove(COMIC_STAGE_HTML_CLASS);
  if (!theme) return () => {};

  const style = doc.createElement('style');
  style.id = COMIC_STAGE_STYLE_ID;
  style.textContent = `
    html.${COMIC_STAGE_HTML_CLASS} {
      background-color: ${theme.background};
    }
    html.${COMIC_STAGE_HTML_CLASS} body {
      padding: ${theme.padding}px;
      box-sizing: border-box;
      background-color: ${theme.background};
    }
  `;
  doc.head.appendChild(style);
  root.classList.add(COMIC_STAGE_HTML_CLASS);

  return () => {
    style.remove();
    root.classList.remove(COMIC_STAGE_HTML_CLASS);
  };
};
