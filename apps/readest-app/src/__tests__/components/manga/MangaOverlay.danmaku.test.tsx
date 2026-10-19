import '../../setupMemoryStorage';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import MangaOverlay, {
  MANGA_CHIP_CLASS,
  MANGA_GUTTER_CLASS,
  MANGA_LAYER_CLASS,
  computeMangaGutterWidth,
  estimateMangaDanmakuChipHeight,
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

const resultWith = (
  bubbles: MangaPageResult['bubbles'],
  width = 2000,
  height = 3000,
): MangaPageResult => ({ width, height, bubbles });

let container: HTMLDivElement;
let image: HTMLImageElement;

const setup = ({
  containerWidth = 500,
  imageWidth = 500,
  imageHeight = 750,
  naturalWidth = 2000,
  naturalHeight = 3000,
}: {
  containerWidth?: number;
  imageWidth?: number;
  imageHeight?: number;
  naturalWidth?: number;
  naturalHeight?: number;
} = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);

  image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: naturalWidth, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: naturalHeight, configurable: true });
  image.getBoundingClientRect = () => rect(0, 0, imageWidth, imageHeight);
  container.getBoundingClientRect = () => rect(0, 0, containerWidth, imageHeight);
  container.appendChild(image);
};

const gutter = (side: 'left' | 'right') =>
  container.querySelector<HTMLElement>(`.${MANGA_GUTTER_CLASS}[data-side="${side}"]`);

beforeEach(() => {
  useThemeStore.setState({ isDarkMode: false });
});

afterEach(() => {
  cleanup();
  container?.remove();
});

describe('MangaOverlay danmaku mode', () => {
  it('computes gutter width from the container ratio within its bounds', () => {
    expect(computeMangaGutterWidth(2000)).toBe(300);
    expect(computeMangaGutterWidth(1000)).toBe(200);
    expect(computeMangaGutterWidth(500)).toBe(150);
    // Too little room: (container - 120) / 2 wins over the clamped ratio.
    expect(computeMangaGutterWidth(300)).toBe(90);
    expect(computeMangaGutterWidth(0)).toBe(0);
  });

  it('shrinks the image, reserves both margins, and restores them on unmount', async () => {
    setup();
    image.style.setProperty('width', '480px');
    image.style.setProperty('max-width', '100%');
    image.style.setProperty('height', '720px');
    image.style.setProperty('margin-left', '5px');
    image.style.setProperty('margin-right', '7px');

    const { unmount } = render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([
          { box: [100, 200, 300, 400], src: '原文', dst: '译文', vertical: false },
        ])}
      />,
    );

    await screen.findByText('译文');
    // 500 - 150 * 2 = 200px available, so the 500px-wide image is narrowed.
    expect(image.style.width).toBe('200px');
    expect(image.style.maxWidth).toBe('none');
    expect(image.style.height).toBe('auto');
    expect(image.style.marginLeft).toBe('150px');
    expect(image.style.marginRight).toBe('150px');
    expect(gutter('left')?.style.width).toBe('150px');

    unmount();

    expect(image.style.width).toBe('480px');
    expect(image.style.maxWidth).toBe('100%');
    expect(image.style.height).toBe('720px');
    expect(image.style.marginLeft).toBe('5px');
    expect(image.style.marginRight).toBe('7px');
    expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).toBeNull();
  });

  it('assigns bubbles to the gutter on their horizontal half', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([
          { box: [100, 200, 300, 400], src: '左原文', dst: '左译文', vertical: false },
          { box: [1500, 200, 1700, 400], src: '右原文', dst: '右译文', vertical: false },
        ])}
      />,
    );

    await screen.findByText('左译文');
    expect(gutter('left')?.textContent).toContain('左译文');
    expect(gutter('left')?.textContent).not.toContain('右译文');
    expect(gutter('right')?.textContent).toContain('右译文');
    expect(gutter('right')?.textContent).not.toContain('左译文');
  });

  it('pushes a second chip down when two anchors are close in one gutter', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([
          { box: [100, 1000, 300, 1100], src: '一', dst: '第一条', vertical: false },
          { box: [100, 1050, 300, 1150], src: '二', dst: '第二条', vertical: false },
        ])}
      />,
    );

    await screen.findByText('第一条');
    const chips = Array.from(container.querySelectorAll<HTMLElement>(`.${MANGA_CHIP_CLASS}`));
    expect(chips).toHaveLength(2);

    const firstTop = parseFloat(chips[0]!.style.top);
    const secondTop = parseFloat(chips[1]!.style.top);
    const firstHeight = estimateMangaDanmakuChipHeight('第一条', 150);
    expect(secondTop).toBeGreaterThanOrEqual(firstTop + firstHeight + 6 - 0.01);
  });

  it('makes an overflowing gutter scrollable and leaves the other pass-through', async () => {
    setup({ imageHeight: 100 });
    const dense = Array.from({ length: 6 }, (_, index) => ({
      box: [100, 1400 + index * 20, 300, 1420 + index * 20] as [number, number, number, number],
      src: `原${index}`,
      dst: `左译文${index}`,
      vertical: false,
    }));

    render(
      <MangaOverlay
        imageEl={image}
        mode='danmaku'
        result={resultWith([
          ...dense,
          { box: [1500, 1400, 1700, 1420], src: '右原', dst: '右译文', vertical: false },
        ])}
      />,
    );

    await screen.findByText('左译文0');

    const left = gutter('left');
    const right = gutter('right');
    expect(left?.style.overflowY).toBe('auto');
    expect(left?.style.pointerEvents).toBe('auto');
    expect(right?.style.overflowY).toBe('visible');
    expect(right?.style.pointerEvents).toBe('none');
  });

  it('creates no gutters for an empty page', () => {
    setup();
    render(<MangaOverlay imageEl={image} mode='danmaku' result={resultWith([])} />);

    expect(container.querySelector(`.${MANGA_GUTTER_CLASS}`)).toBeNull();
    expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).toBeNull();
  });

  it('keeps bubble mode free of gutters', async () => {
    setup();
    render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          { box: [100, 200, 300, 400], src: '原文', dst: '译文', vertical: false },
        ])}
      />,
    );

    await screen.findByText('译文');
    expect(container.querySelector(`.${MANGA_GUTTER_CLASS}`)).toBeNull();
    await waitFor(() => expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).not.toBeNull());
  });
});
