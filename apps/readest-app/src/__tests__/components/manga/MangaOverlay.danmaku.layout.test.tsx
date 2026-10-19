import '../../setupMemoryStorage';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import MangaOverlay, {
  MANGA_CHIP_CLASS,
  MANGA_GUTTER_CLASS,
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

const bubble = (dst = '译文'): MangaPageResult['bubbles'][number] => ({
  box: [100, 200, 300, 400],
  src: '原文',
  dst,
  vertical: false,
});

let container: HTMLDivElement;
let image: HTMLImageElement;

const setup = ({
  containerWidth = 800,
  containerHeight = 600,
  imageLeft = 0,
  imageTop = 0,
  imageWidth = 500,
  imageHeight = 750,
}: {
  containerWidth?: number;
  containerHeight?: number;
  imageLeft?: number;
  imageTop?: number;
  imageWidth?: number;
  imageHeight?: number;
} = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);

  image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 2000, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 3000, configurable: true });
  image.getBoundingClientRect = () => rect(imageLeft, imageTop, imageWidth, imageHeight);
  container.getBoundingClientRect = () => rect(0, 0, containerWidth, containerHeight);
  container.appendChild(image);
};

const gutter = (side: 'left' | 'right') =>
  container.querySelector<HTMLElement>(`.${MANGA_GUTTER_CLASS}[data-side="${side}"]`);

const chip = () => container.querySelector<HTMLElement>(`.${MANGA_CHIP_CLASS}`);

const renderDanmaku = (bubbles: MangaPageResult['bubbles'] = [bubble()]) =>
  render(<MangaOverlay imageEl={image} mode='danmaku' result={resultWith(bubbles)} />);

beforeEach(() => {
  useThemeStore.setState({ isDarkMode: false });
});

afterEach(() => {
  cleanup();
  container?.remove();
});

describe('MangaOverlay danmaku layout against the image box', () => {
  it('uses existing blank space instead of narrowing a centred image', async () => {
    // 800px container, 270px centred image: 265px of blank space per side.
    setup({ containerWidth: 800, imageLeft: 265, imageWidth: 270, imageHeight: 400 });

    renderDanmaku();
    await screen.findByText('译文');

    // 500 - 300 = 200px, clamped by the natural gutter (800 * 0.2 = 160).
    expect(gutter('left')?.style.width).toBe('160px');
    expect(gutter('right')?.style.width).toBe('160px');
    expect(image.style.width).toBe('');
    expect(image.style.maxWidth).toBe('');
    expect(image.style.marginLeft).toBe('');
    expect(image.style.marginRight).toBe('');
  });

  it('places the gutters flush with the image edges when space exists', async () => {
    setup({ containerWidth: 800, imageLeft: 265, imageWidth: 270, imageHeight: 400 });

    renderDanmaku();
    await screen.findByText('译文');

    // Left gutter ends exactly where the image starts (265 - 160 = 105); the
    // right gutter starts exactly where the image ends (265 + 270 = 535).
    expect(gutter('left')?.style.left).toBe('105px');
    expect(gutter('right')?.style.left).toBe('535px');
    const imageRight = 265 + 270;
    expect(parseFloat(gutter('right')!.style.left)).toBeGreaterThanOrEqual(imageRight);
  });

  it('pins each pill 8px from the artwork with the spine facing the page', async () => {
    setup({ containerWidth: 800, imageLeft: 265, imageWidth: 270, imageHeight: 400 });

    renderDanmaku([
      { box: [100, 200, 300, 400], src: '左原文', dst: '左译文', vertical: false },
      { box: [1500, 200, 1700, 400], src: '右原文', dst: '右译文', vertical: false },
    ]);
    await screen.findByText('左译文');
    await screen.findByText('右译文');

    const imageLeft = 265;
    const imageRight = 265 + 270;
    const leftChip = container.querySelector<HTMLElement>(
      `.${MANGA_CHIP_CLASS}[data-side="left"]`,
    )!;
    const rightChip = container.querySelector<HTMLElement>(
      `.${MANGA_CHIP_CLASS}[data-side="right"]`,
    )!;

    // The pill's right edge lands on imageLeft - 8; the gutter's right edge is
    // the image's left edge.
    const leftGutter = gutter('left')!;
    const leftPillRight =
      parseFloat(leftGutter.style.left) + parseFloat(leftGutter.style.width) -
      parseFloat(leftChip.style.right);
    expect(leftPillRight).toBe(imageLeft - 8);
    expect(leftChip.style.borderRightWidth).toBe('3px');
    expect(leftChip.style.borderRightStyle).toBe('solid');
    expect(leftChip.style.borderLeftStyle).toBe('none');

    const rightGutter = gutter('right')!;
    const rightPillLeft = parseFloat(rightGutter.style.left) + parseFloat(rightChip.style.left);
    expect(rightPillLeft).toBe(imageRight + 8);
    expect(rightChip.style.borderLeftWidth).toBe('3px');
    expect(rightChip.style.borderLeftStyle).toBe('solid');
    expect(rightChip.style.borderRightStyle).toBe('none');

    expect(leftChip.style.fontSize).toBe('15px');
    expect(leftChip.style.lineHeight).toBe('1.65');
  });

  it('narrows the image by exactly two gutter widths when space is tight', async () => {
    // 500px container, image using 420px: only 40px of blank space per side.
    setup({ containerWidth: 500, imageLeft: 40, imageWidth: 420, imageHeight: 600 });

    renderDanmaku();
    await screen.findByText('译文');

    // Natural gutter 150px, so the image gets 500 - 2 * 150 = 200px.
    expect(gutter('left')?.style.width).toBe('150px');
    expect(image.style.width).toBe('200px');
    expect(image.style.marginLeft).toBe('150px');
    expect(image.style.marginRight).toBe('150px');
    // The columns hug the narrowed image (left 150, right 350) with no extra
    // viewport inset; the pills themselves keep the 8px gap.
    expect(gutter('left')?.style.left).toBe('0px');
    expect(gutter('right')?.style.left).toBe('350px');
  });

  it('aligns gutter height and top with the rendered image box', async () => {
    setup({ containerWidth: 800, imageLeft: 265, imageTop: 40, imageWidth: 270, imageHeight: 400 });

    renderDanmaku();
    await screen.findByText('译文');

    expect(gutter('left')?.style.top).toBe('40px');
    expect(gutter('left')?.style.height).toBe('400px');
    expect(gutter('right')?.style.top).toBe('40px');
    expect(gutter('right')?.style.height).toBe('400px');
  });

  it('keeps chip text unclipped', async () => {
    setup({ containerWidth: 800, imageLeft: 265, imageWidth: 270, imageHeight: 400 });

    renderDanmaku([bubble('很长的译文内容不能被裁切')]);
    await screen.findByText('很长的译文内容不能被裁切');

    const el = chip()!;
    expect(el.style.whiteSpace).toBe('pre-wrap');
    expect(el.style.overflowWrap).toBe('anywhere');
    expect(el.style.maxHeight).toBe('none');
    expect(el.style.overflow).toBe('visible');
    expect(el.style.boxSizing).toBe('border-box');
    expect(el.style.padding).toBe('3px 6px');
  });

  it('uses an opaque white chip in dark mode', async () => {
    useThemeStore.setState({ isDarkMode: true });
    setup({ containerWidth: 800, imageLeft: 265, imageWidth: 270, imageHeight: 400 });

    renderDanmaku();
    await screen.findByText('译文');

    expect(chip()?.style.background).toBe('rgba(255, 255, 255, 0.94)');
  });

  it('drops to 13px and a 2px spine in a narrow gutter', async () => {
    setup({ containerWidth: 200, imageWidth: 200, imageHeight: 300 });

    renderDanmaku([bubble('窄栏译文')]);
    await screen.findByText('窄栏译文');

    // (200 - 120) / 2 = 40px gutter, below the 90px comfortable width.
    expect(gutter('left')?.style.width).toBe('40px');
    expect(chip()?.style.fontSize).toBe('13px');
    expect(chip()?.style.lineHeight).toBe('1.65');
    expect(chip()?.style.borderRightWidth).toBe('2px');
    expect(chip()?.style.borderLeftStyle).toBe('none');
  });
});
