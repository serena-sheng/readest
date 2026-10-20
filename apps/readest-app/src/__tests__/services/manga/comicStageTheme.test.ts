import { describe, expect, it } from 'vitest';

import {
  COMIC_STAGE_PADDING,
  COMIC_STAGE_STYLE_ID,
  applyComicStageTheme,
  getComicStageTheme,
} from '@/services/manga/comicStageTheme';

describe('getComicStageTheme', () => {
  it('returns the theme page color and 24px gutter for a light theme', () => {
    expect(getComicStageTheme({ isDarkMode: false, pageBackground: '#FDF7FA' })).toEqual({
      background: '#FDF7FA',
      padding: COMIC_STAGE_PADDING,
    });
    expect(COMIC_STAGE_PADDING).toBe(24);
  });

  it('paints the theme page color in a dark theme too', () => {
    expect(getComicStageTheme({ isDarkMode: true, pageBackground: '#342E25' })).toEqual({
      background: '#342E25',
      padding: 24,
    });
  });

  it('returns null when the theme exposes no page color', () => {
    expect(getComicStageTheme({ isDarkMode: false, pageBackground: '   ' })).toBeNull();
    expect(getComicStageTheme({ isDarkMode: false, pageBackground: null })).toBeNull();
  });
});

describe('applyComicStageTheme', () => {
  const makeDoc = () => new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html');

  it('paints the stage and restores the document in its cleanup', () => {
    const doc = makeDoc();
    const cleanup = applyComicStageTheme(doc, {
      background: '#FDF7FA',
      padding: COMIC_STAGE_PADDING,
    });

    const style = doc.getElementById(COMIC_STAGE_STYLE_ID);
    expect(style?.textContent).toContain('background-color: #FDF7FA');
    expect(style?.textContent).toContain('padding: 24px');
    expect(doc.documentElement.classList.contains('comic-stage-themed')).toBe(true);

    cleanup();
    expect(doc.getElementById(COMIC_STAGE_STYLE_ID)).toBeNull();
    expect(doc.documentElement.classList.contains('comic-stage-themed')).toBe(false);
  });

  it('clears a previously applied stage when given a null theme', () => {
    const doc = makeDoc();
    applyComicStageTheme(doc, { background: '#FDF7FA', padding: COMIC_STAGE_PADDING });

    applyComicStageTheme(doc, null);
    expect(doc.getElementById(COMIC_STAGE_STYLE_ID)).toBeNull();
    expect(doc.documentElement.classList.contains('comic-stage-themed')).toBe(false);
  });
});
