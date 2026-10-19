import '../../setupMemoryStorage';

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import MangaOverlay, { MANGA_LAYER_CLASS } from '@/app/reader/components/manga/MangaOverlay';
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

beforeEach(() => {
  useThemeStore.setState({ isDarkMode: false });
  container = document.createElement('div');
  document.body.appendChild(container);

  image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { value: 2000, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 3000, configurable: true });
  image.getBoundingClientRect = () => rect(0, 0, 500, 750);
  container.getBoundingClientRect = () => rect(0, 0, 500, 750);
  container.appendChild(image);
});

afterEach(() => {
  cleanup();
  container.remove();
});

describe('MangaOverlay', () => {
  it('renders one box per bubble with coordinates scaled from natural pixels', async () => {
    render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          { box: [100, 200, 300, 400], src: '原文一', dst: '译文一', vertical: false },
          { box: [800, 600, 1200, 1000], src: '原文二', dst: '译文二', vertical: false },
        ])}
      />,
    );

    await screen.findByText('译文一');
    // 500 / 2000 = 0.25 on both axes.
    const bubbles = container.querySelectorAll('.manga-bubble-text');
    expect(bubbles).toHaveLength(2);
    expect((bubbles[0] as HTMLElement).style.left).toBe('25px');
    expect((bubbles[0] as HTMLElement).style.top).toBe('50px');
    expect((bubbles[0] as HTMLElement).style.width).toBe('50px');
    expect((bubbles[0] as HTMLElement).style.height).toBe('50px');
    expect((bubbles[1] as HTMLElement).style.left).toBe('200px');
    expect((bubbles[1] as HTMLElement).style.top).toBe('150px');
  });

  it('lays vertical bubbles out top to bottom', async () => {
    render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          { box: [100, 200, 300, 900], src: 'たて', dst: '竖排', vertical: true },
          { box: [800, 600, 1200, 900], src: 'よこ', dst: '横排', vertical: false },
        ])}
      />,
    );

    const vertical = await screen.findByText('竖排');
    const horizontal = screen.getByText('横排');
    expect(vertical.getAttribute('style')).toContain('writing-mode: vertical-rl');
    expect(vertical.getAttribute('style')).toContain('text-orientation: upright');
    expect(horizontal.getAttribute('style')).not.toContain('writing-mode');
  });

  it('removes the whole layer on unmount', async () => {
    const { unmount } = render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          { box: [100, 200, 300, 400], src: '原文', dst: '译文', vertical: false },
        ])}
      />,
    );

    await screen.findByText('译文');
    expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).not.toBeNull();

    unmount();
    expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).toBeNull();
  });

  it('uses a dark bubble surface in dark mode', async () => {
    useThemeStore.setState({ isDarkMode: true });

    render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          { box: [100, 200, 300, 400], src: '原文', dst: '译文', vertical: false },
        ])}
      />,
    );

    const bubble = await screen.findByText('译文');
    expect(bubble.getAttribute('style')).toContain('rgba(17, 17, 17, 0.92)');
  });

  it('renders no layer when there are no bubbles', () => {
    render(<MangaOverlay imageEl={image} result={resultWith([])} />);

    expect(container.querySelector(`.${MANGA_LAYER_CLASS}`)).toBeNull();
    expect(container.querySelectorAll('.manga-bubble-text')).toHaveLength(0);
  });

  it('clamps the font size at 12px for a tiny box', async () => {
    render(
      <MangaOverlay
        imageEl={image}
        result={resultWith([
          {
            box: [0, 0, 40, 40],
            src: '長い原文',
            dst: '这是一段很长的译文需要缩小到最小字号',
            vertical: false,
          },
        ])}
      />,
    );

    const bubble = await screen.findByText('这是一段很长的译文需要缩小到最小字号');
    await waitFor(() => expect(bubble.style.fontSize).toBe('12px'));
    expect(bubble.style.lineHeight).toBe('1.5');
  });
});
