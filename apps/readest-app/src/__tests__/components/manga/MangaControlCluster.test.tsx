import '../../setupMemoryStorage';

import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MangaControlCluster, {
  MANGA_CONTROL_EDGE,
  MANGA_CONTROL_IDLE_MS,
  MANGA_CONTROL_IDLE_OPACITY,
  MANGA_DISPLAY_OPTIONS,
  MANGA_SEGMENT_HEIGHT,
  MANGA_SEGMENT_WIDTH,
} from '@/app/reader/components/manga/MangaControlCluster';
import type { MangaTranslationMode } from '@/types/book';
import type { MangaBubble } from '@/services/manga/types';

const h = vi.hoisted(() => ({
  onTranslate: vi.fn(),
  onSelectMode: vi.fn(),
  onFitPage: vi.fn(),
  onRetranslate: vi.fn(),
  onClose: vi.fn(),
}));

const BUBBLES: MangaBubble[] = [
  { box: [100, 200, 300, 400], src: 'こんにちは', dst: '你好', vertical: false },
  { box: [1500, 200, 1700, 400], src: 'さようなら', dst: '再见', vertical: false },
];

const renderCluster = (overrides: Partial<React.ComponentProps<typeof MangaControlCluster>> = {}) =>
  render(
    <MangaControlCluster
      available
      loading={false}
      mode='off'
      danmakuDisabledReason={null}
      bubbles={[]}
      onTranslate={h.onTranslate}
      onSelectMode={h.onSelectMode}
      onFitPage={h.onFitPage}
      onRetranslate={h.onRetranslate}
      onClose={h.onClose}
      {...overrides}
    />,
  );

const translateButton = () => screen.getByRole('button', { name: '翻译本页' });
const modeButton = (label: string) => screen.getByRole('button', { name: label });
const surface = () => screen.getByTestId('manga-control-surface');

beforeEach(() => {
  vi.useFakeTimers();
  h.onTranslate.mockReset();
  h.onSelectMode.mockReset();
  h.onFitPage.mockReset();
  h.onRetranslate.mockReset();
  h.onClose.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });
});

describe('MangaControlCluster', () => {
  it('renders one button per display state, with the current one pressed', () => {
    renderCluster({ mode: 'bubble' });

    for (const option of MANGA_DISPLAY_OPTIONS) {
      expect(modeButton(option.label)).toBeTruthy();
    }
    expect(modeButton('嵌字').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('侧栏').getAttribute('aria-pressed')).toBe('false');
    expect(modeButton('原').getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to the side columns in one click without passing through the bubble mode', () => {
    renderCluster({ mode: 'off' });

    fireEvent.click(modeButton('侧栏'));

    expect(h.onSelectMode).toHaveBeenCalledTimes(1);
    expect(h.onSelectMode).toHaveBeenCalledWith('danmaku');
    expect(h.onSelectMode).not.toHaveBeenCalledWith('bubble');
  });

  it('enables 翻译本页 only while the page is untranslated and reports its busy state', () => {
    const { rerender } = renderCluster({ mode: 'off' });

    expect((translateButton() as HTMLButtonElement).disabled).toBe(false);
    expect(translateButton().getAttribute('aria-busy')).toBe('false');
    fireEvent.click(translateButton());
    expect(h.onTranslate).toHaveBeenCalledTimes(1);

    rerender(
      <MangaControlCluster
        available
        loading
        mode='off'
        danmakuDisabledReason={null}
        bubbles={[]}
        onTranslate={h.onTranslate}
        onSelectMode={h.onSelectMode}
        onFitPage={h.onFitPage}
        onRetranslate={h.onRetranslate}
        onClose={h.onClose}
      />,
    );
    expect(translateButton().getAttribute('aria-busy')).toBe('true');
    expect((translateButton() as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <MangaControlCluster
        available
        loading={false}
        mode='bubble'
        danmakuDisabledReason={null}
        bubbles={[]}
        onTranslate={h.onTranslate}
        onSelectMode={h.onSelectMode}
        onFitPage={h.onFitPage}
        onRetranslate={h.onRetranslate}
        onClose={h.onClose}
      />,
    );
    expect((translateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('dims to 60% after the pointer rests and comes back on movement', () => {
    renderCluster();

    expect(surface().style.opacity).toBe('1');

    act(() => {
      vi.advanceTimersByTime(MANGA_CONTROL_IDLE_MS);
    });
    expect(surface().style.opacity).toBe(String(MANGA_CONTROL_IDLE_OPACITY));

    act(() => {
      fireEvent.pointerMove(window);
    });
    expect(surface().style.opacity).toBe('1');
  });

  it('maps 1/2/3 straight to 嵌字/侧栏/原', () => {
    renderCluster({ mode: 'off' });

    act(() => {
      fireEvent.keyDown(document.body, { key: '1' });
      fireEvent.keyDown(document.body, { key: '2' });
      fireEvent.keyDown(document.body, { key: '3' });
    });

    expect(h.onSelectMode.mock.calls.map(([mode]) => mode as MangaTranslationMode)).toEqual([
      'bubble',
      'danmaku',
      'off',
    ]);
  });

  it('ignores 1/2/3 while the reader is typing', () => {
    renderCluster();
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      fireEvent.keyDown(input, { key: '2' });
    });

    expect(h.onSelectMode).not.toHaveBeenCalled();
    input.remove();
  });

  it('sizes the segmented control to the spec and disables 侧栏 when it cannot fit', () => {
    renderCluster({ danmakuDisabledReason: 'narrow' });

    const group = screen.getByRole('group', { name: '显示方式' });
    expect(group.style.width).toBe(`${MANGA_SEGMENT_WIDTH}px`);
    expect(group.style.height).toBe(`${MANGA_SEGMENT_HEIGHT}px`);
    expect((modeButton('侧栏') as HTMLButtonElement).disabled).toBe(true);
    expect(modeButton('侧栏').title).toContain('窗口太窄');
  });

  it('moves to the top-right corner when the reading area is shorter than 480px', () => {
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true, writable: true });
    renderCluster();

    const cluster = screen.getByTestId('manga-control-cluster');
    expect(cluster.style.top).toBe(`${MANGA_CONTROL_EDGE}px`);
    expect(cluster.style.bottom).toBe('');
    expect(cluster.style.right).toBe(`${MANGA_CONTROL_EDGE}px`);
  });

  it('offers the page actions in 更多 and calls each one', () => {
    renderCluster({ mode: 'bubble' });

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    const menu = screen.getByRole('menu', { name: '更多' });
    for (const label of ['气泡列表', '适应页面', '重新翻译', '关闭']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
    }

    fireEvent.click(within(menu).getByRole('menuitem', { name: '适应页面' }));
    expect(h.onFitPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重新翻译' }));
    expect(h.onRetranslate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('lists every bubble with its translation and source', () => {
    renderCluster({ mode: 'bubble', bubbles: BUBBLES });

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '气泡列表' }));

    const list = screen.getByRole('region', { name: '本页气泡' });
    expect(within(list).getByText('你好')).toBeTruthy();
    expect(within(list).getByText('こんにちは')).toBeTruthy();
    expect(within(list).getByText('再见')).toBeTruthy();
    expect(within(list).getByText('さようなら')).toBeTruthy();
  });
});
