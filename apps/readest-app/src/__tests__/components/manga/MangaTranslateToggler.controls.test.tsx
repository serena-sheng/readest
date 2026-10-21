import '../../setupMemoryStorage';

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MangaTranslationMode } from '@/app/reader/hooks/useMangaTranslation';
import MangaTranslateToggler from '@/app/reader/components/manga/MangaTranslateToggler';

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  toggle: vi.fn(),
  setMode: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  retranslate: vi.fn(),
  dismissStatus: vi.fn(),
  dismissModelSetup: vi.fn(),
  fitPage: vi.fn(),
}));

vi.mock('@/app/reader/hooks/useMangaTranslation', () => ({
  useMangaTranslation: () => h.state,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: (selector: (state: { isDarkMode: boolean }) => unknown) =>
    selector({ isDarkMode: false }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setSettingsDialogOpen: vi.fn(),
      setSettingsDialogBookKey: vi.fn(),
    }),
}));

// The setup guide shell is exercised elsewhere; here only the closed state matters.
vi.mock('@/components/Dialog', () => ({
  default: () => null,
}));

const baseState = (mode: MangaTranslationMode) => ({
  available: true,
  loading: false,
  translated: mode !== 'off',
  mode,
  imageEl: null,
  result: null,
  status: null,
  danmakuDisabledReason: null,
  needsModelSetup: false,
  toggle: h.toggle,
  setMode: h.setMode,
  stop: h.stop,
  retry: h.retry,
  retranslate: h.retranslate,
  dismissStatus: h.dismissStatus,
  dismissModelSetup: h.dismissModelSetup,
  fitPage: h.fitPage,
});

const renderToggler = () =>
  render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

const translateButton = () => screen.getByRole('button', { name: '翻译本页' });
const modeButton = (label: string) => screen.getByRole('button', { name: label });

beforeEach(() => {
  window.localStorage.clear();
  h.state = baseState('off');
  h.toggle.mockReset();
  h.setMode.mockReset();

  const host = document.createElement('div');
  host.id = 'gridcell-book-1';
  document.body.appendChild(host);
});

afterEach(() => {
  cleanup();
  document.getElementById('gridcell-book-1')?.remove();
});

describe('MangaTranslateToggler controls', () => {
  it('mounts the three independent display controls into the reading area', () => {
    const { container } = renderToggler();

    const host = document.getElementById('gridcell-book-1')!;
    expect(within(host).getByTestId('manga-control-cluster')).toBeTruthy();
    for (const label of ['嵌字', '侧栏', '原']) {
      expect(within(host).getByRole('button', { name: label })).toBeTruthy();
    }
    // The toolbar slot itself no longer owns a cycling button.
    expect(container.querySelector('button')).toBeNull();
  });

  it('switches to 侧栏 in one click, never cycling through 嵌字', () => {
    renderToggler();

    fireEvent.click(modeButton('侧栏'));

    expect(h.setMode).toHaveBeenCalledTimes(1);
    expect(h.setMode).toHaveBeenCalledWith('danmaku');
    expect(h.setMode).not.toHaveBeenCalledWith('bubble');
  });

  it('translates the page from the primary button only while untranslated', () => {
    const { rerender } = renderToggler();

    expect((translateButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(translateButton());
    expect(h.toggle).toHaveBeenCalledTimes(1);

    h.state = baseState('bubble');
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));
    expect((translateButton() as HTMLButtonElement).disabled).toBe(true);
    expect(modeButton('嵌字').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks every display state with aria-pressed', () => {
    h.state = baseState('danmaku');
    const { rerender } = renderToggler();

    expect(modeButton('嵌字').getAttribute('aria-pressed')).toBe('false');
    expect(modeButton('侧栏').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('原').getAttribute('aria-pressed')).toBe('false');

    h.state = baseState('off');
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));
    expect(modeButton('原').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports progress with aria-busy and keeps the display choices available', () => {
    h.state = { ...baseState('off'), loading: true };
    renderToggler();

    expect(translateButton().getAttribute('aria-busy')).toBe('true');
    expect((translateButton() as HTMLButtonElement).disabled).toBe(true);
    expect((modeButton('嵌字') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(modeButton('嵌字'));
    expect(h.setMode).toHaveBeenCalledWith('bubble');
  });

  it('disables the cluster on an image-less page but keeps it mounted', () => {
    h.state = baseState('bubble');
    const { rerender } = renderToggler();
    expect(screen.getByTestId('manga-control-cluster')).toBeTruthy();

    h.state = { ...baseState('bubble'), available: false };
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    expect(screen.getByTestId('manga-control-cluster')).toBeTruthy();
    expect((translateButton() as HTMLButtonElement).disabled).toBe(true);
    expect((modeButton('嵌字') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables 侧栏 and states why when the gutters cannot fit', () => {
    h.state = { ...baseState('bubble'), danmakuDisabledReason: 'narrow' };
    renderToggler();

    const side = modeButton('侧栏') as HTMLButtonElement;
    expect(side.disabled).toBe(true);
    expect(side.title).toContain('窗口太窄');
  });

  it('routes the 更多 menu to fit, retranslate and close', () => {
    h.state = baseState('bubble');
    renderToggler();

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '适应页面' }));
    expect(h.fitPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重新翻译' }));
    expect(h.retranslate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭' }));
    expect(h.setMode).toHaveBeenCalledWith('off');
  });
});
