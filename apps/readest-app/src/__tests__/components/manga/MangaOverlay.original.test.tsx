import '../../setupMemoryStorage';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import MangaOverlay, {
  MANGA_CHIP_BADGE_CLASS,
  MANGA_CHIP_BODY_CLASS,
  MANGA_CHIP_CLASS,
} from '@/app/reader/components/manga/MangaOverlay';
import type { MangaPageResult } from '@/services/manga/types';
import { useThemeStore } from '@/store/themeStore';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

const resultWith = (bubbles: MangaPageResult['bubbles']): MangaPageResult => ({
  width: 2000,
  height: 3000,
  bubbles,
});

let container: HTMLDivElement;
let image: HTMLImageElement;

const setup = () => {
  container = document.createElement('div');
  document.body.appendChild(container);

  image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 2000, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 3000, configurable: true });
  image.getBoundingClientRect = () => rect(0, 0, 500, 750);
  container.getBoundingClientRect = () => rect(0, 0, 500, 750);
  container.appendChild(image);
};

const bubble = (src: string, dst: string) => ({ box: [100, 200, 300, 400] as [number, number, number, number], src, dst, vertical: false });

const chip = () => container.querySelector<HTMLElement>(`.${MANGA_CHIP_CLASS}`);
const chipBody = () => chip()?.querySelector<HTMLElement>(`.${MANGA_CHIP_BODY_CLASS}`);
const chipBadge = () => chip()?.querySelector<HTMLElement>(`.${MANGA_CHIP_BADGE_CLASS}`);

beforeEach(() => {
  useThemeStore.setState({ isDarkMode: false });
});

afterEach(() => {
  cleanup();
  container?.remove();
});

describe('MangaOverlay danmaku pill original text', () => {
  it('shows the bubble source on click and switches back on a second click', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([bubble('原文的气泡', '翻译后的文字')])}
      />,
    );
    await screen.findByText('翻译后的文字');

    const pill = chip()!;
    expect(chipBody()?.textContent).toBe('翻译后的文字');
    expect(chipBadge()?.style.display).toBe('none');

    fireEvent.click(pill);
    expect(chipBody()?.textContent).toBe('原文的气泡');
    expect(chipBadge()?.style.display).toBe('');

    fireEvent.click(pill);
    expect(chipBody()?.textContent).toBe('翻译后的文字');
    expect(chipBadge()?.style.display).toBe('none');
  });

  it('keeps aria-pressed and the action label in sync with the shown text', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([bubble('原文', '译文')])}
      />,
    );
    await screen.findByText('译文');

    const pill = chip()!;
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    expect(pill.getAttribute('aria-label')).toBe('显示原文');

    fireEvent.click(pill);
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.getAttribute('aria-label')).toBe('显示译文');
  });

  it('toggles from the keyboard with Enter and Space', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([bubble('键盘原文', '键盘译文')])}
      />,
    );
    await screen.findByText('键盘译文');

    const pill = chip()!;
    expect(pill.tabIndex).toBe(0);

    pill.focus();
    fireEvent.keyDown(pill, { key: 'Enter' });
    expect(chipBody()?.textContent).toBe('键盘原文');

    fireEvent.keyDown(pill, { key: ' ' });
    expect(chipBody()?.textContent).toBe('键盘译文');
  });
});
