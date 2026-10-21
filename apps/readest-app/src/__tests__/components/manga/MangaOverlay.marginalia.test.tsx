import '../../setupMemoryStorage';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MangaOverlay, {
  MANGA_CHIP_BADGE_CLASS,
  MANGA_CHIP_CLASS,
} from '@/app/reader/components/manga/MangaOverlay';
import type { MangaPageResult } from '@/services/manga/types';
import { useThemeStore } from '@/store/themeStore';

const h = vi.hoisted(() => ({ isEink: false }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isEink: h.isEink }, envConfig: {} }),
}));

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

const LEFT_BUBBLE: MangaPageResult['bubbles'][number] = {
  box: [100, 200, 300, 400],
  src: '左原文',
  dst: '左译文',
  vertical: false,
};
const RIGHT_BUBBLE: MangaPageResult['bubbles'][number] = {
  box: [1500, 200, 1700, 400],
  src: '右原文',
  dst: '右译文',
  vertical: false,
};

let container: HTMLDivElement;
let image: HTMLImageElement;

const setup = () => {
  container = document.createElement('div');
  document.body.appendChild(container);

  image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 2000, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 3000, configurable: true });
  image.getBoundingClientRect = () => rect(265, 0, 270, 400);
  container.getBoundingClientRect = () => rect(0, 0, 800, 600);
  container.appendChild(image);
};

const chip = (side: 'left' | 'right') =>
  container.querySelector<HTMLElement>(`.${MANGA_CHIP_CLASS}[data-side="${side}"]`);

const renderDanmaku = (bubbles: MangaPageResult['bubbles'] = [LEFT_BUBBLE, RIGHT_BUBBLE]) =>
  render(<MangaOverlay imageEl={image} mode='danmaku' result={resultWith(bubbles)} />);

beforeEach(() => {
  useThemeStore.setState({ isDarkMode: false });
  h.isEink = false;
});

afterEach(() => {
  cleanup();
  container?.remove();
});

describe('MangaOverlay marginalia syntax', () => {
  it('sets the translation on a paper block instead of a floating card', async () => {
    setup();
    renderDanmaku();
    await screen.findByText('左译文');

    const el = chip('left')!;
    expect(el.style.background).toBe('rgb(237, 230, 216)');
    // Paper is flat: no shadow, no blur lifting it off the artwork.
    expect(el.style.boxShadow).toBe('');
    expect(el.style.backdropFilter).toBe('');
    expect(el.style.getPropertyValue('-webkit-backdrop-filter')).toBe('');
  });

  it('draws a 2px primary rule on the artwork-facing edge of each column', async () => {
    setup();
    renderDanmaku();
    await screen.findByText('左译文');
    await screen.findByText('右译文');

    const left = chip('left')!;
    expect(left.style.borderRightWidth).toBe('2px');
    expect(left.style.borderRightStyle).toBe('solid');
    expect(left.style.borderRightColor).toBe('var(--color-primary, #305F4B)');
    expect(left.style.borderLeftStyle).toBe('none');
    expect(left.style.borderRadius).toBe('0 2px 2px 0');

    const right = chip('right')!;
    expect(right.style.borderLeftWidth).toBe('2px');
    expect(right.style.borderLeftStyle).toBe('solid');
    expect(right.style.borderLeftColor).toBe('var(--color-primary, #305F4B)');
    expect(right.style.borderRightStyle).toBe('none');
    expect(right.style.borderRadius).toBe('2px 0 0 2px');
  });

  it('sets the marginalia type: the book serif at 15/26 and a 22em measure', async () => {
    setup();
    renderDanmaku();
    await screen.findByText('左译文');

    const el = chip('left')!;
    // A margin note speaks in the book's voice, not the UI's.
    expect(el.style.fontFamily).toContain('Georgia');
    expect(el.style.fontFamily).toContain('Songti SC');
    expect(el.style.fontFamily).toContain('Noto Serif SC');
    expect(el.style.fontFamily).toContain('serif');
    expect(el.style.fontFamily).not.toContain('PingFang SC');
    expect(el.style.fontSize).toBe('15px');
    expect(el.style.lineHeight).toBe('26px');
    // Capped at the measure while still never overflowing a narrow gutter.
    expect(el.style.maxWidth).toBe('min(22em, 100%)');
    expect(el.style.getPropertyValue('text-wrap')).toBe('pretty');
    expect(el.style.color).toBe('var(--color-base-content, #1d1d1f)');
    expect(el.style.color).not.toBe('#3A2230');
  });

  it('steps the pill up to 16px in a wide (≥1400px) reading area', async () => {
    setup();
    Object.defineProperty(window, 'innerWidth', { value: 1500, configurable: true, writable: true });

    try {
      renderDanmaku([LEFT_BUBBLE]);
      await screen.findByText('左译文');
      expect(chip('left')?.style.fontSize).toBe('16px');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
    }
  });

  it('fades each pill in with opacity only, at 120ms', async () => {
    setup();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const original = proto.animate;
    proto.animate = animate;

    try {
      renderDanmaku([LEFT_BUBBLE]);
      await screen.findByText('左译文');
    } finally {
      if (original === undefined) delete proto.animate;
      else proto.animate = original;
    }

    expect(animate).toHaveBeenCalledTimes(1);
    const call = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(call[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(call[1].duration).toBe(120);
  });

  it('hangs the 原 tag on the chip edge instead of outside it', async () => {
    setup();
    renderDanmaku([LEFT_BUBBLE]);
    await screen.findByText('左译文');

    const badge = container.querySelector<HTMLElement>(`.${MANGA_CHIP_BADGE_CLASS}`)!;
    expect(badge.textContent).toBe('原');
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.top).toBe('0px');
    expect(badge.style.getPropertyValue('inset-inline-start')).toBe('0px');
    expect(badge.style.transform).toBe('translateY(-50%)');
    // No negative offsets pushing the tag into the margin any more.
    expect(badge.style.left).toBe('');
    expect(badge.style.background).toBe('var(--color-base-100, #FBFAF7)');
    expect(badge.style.fontSize).toBe('11px');
  });

  it('keeps an opaque fill on e-ink, which cannot composite transparency', async () => {
    h.isEink = true;
    setup();
    renderDanmaku([LEFT_BUBBLE]);
    await screen.findByText('左译文');

    const el = chip('left')!;
    expect(el.style.background).toBe('rgb(237, 230, 216)');
    expect(el.style.boxShadow).toBe('');
    expect(el.style.backdropFilter).toBe('');
    expect(el.style.borderRightWidth).toBe('2px');
  });
});
