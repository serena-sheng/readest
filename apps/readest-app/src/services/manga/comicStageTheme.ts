/**
 * Comic (CBZ) pages are app-rendered bitmaps, so they sit on a stage painted
 * by the reader rather than by the book. The stage paints the theme's own page
 * color — not a fixed slab — so the page reads as paper inside the reader
 * instead of a separate window.
 *
 * The stage is one step darker than the card it sits in: the theme page color
 * mixed 94% with black. That keeps the four surface layers (canvas, card,
 * stage, chip) readable as depth without any shadow. E-ink panels have no
 * luminance headroom for a fifth gray, so there the stage is the card color
 * itself and only the 24px margin separates page from stage.
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
 * `pageBackground` is the theme's page color, which is also the card color the
 * comic sits in. The stage is that color mixed 94% with black; in e-ink mode it
 * stays the card color, because a sixteenth gray would render as noise there.
 */
export const getComicStageTheme = ({
  pageBackground,
  isEink,
}: {
  pageBackground?: string | null;
  isEink?: boolean;
}): ComicStageTheme | null => {
  const background = pageBackground?.trim();
  if (!background) return null;
  return {
    background: isEink ? background : `color-mix(in srgb, ${background} 94%, #000)`,
    padding: COMIC_STAGE_PADDING,
  };
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
