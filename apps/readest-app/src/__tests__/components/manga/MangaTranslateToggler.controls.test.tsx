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
  dismissStatus: vi.fn(),
  dismissModelSetup: vi.fn(),
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
  dismissStatus: h.dismissStatus,
  dismissModelSetup: h.dismissModelSetup,
});

const renderToggler = () =>
  render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

const mainButton = () =>
  screen.getByRole('button', { name: /翻译这一页的漫画文字|漫画翻译：|本页没有可翻译的图片/ });

beforeEach(() => {
  h.state = baseState('off');
  h.toggle.mockReset();
  h.setMode.mockReset();
});

afterEach(cleanup);

describe('MangaTranslateToggler controls', () => {
  it('toggles the overlay from the main button', () => {
    renderToggler();

    fireEvent.click(mainButton());

    expect(h.toggle).toHaveBeenCalledTimes(1);
  });

  it('opens a menu with the three display modes and their descriptions', () => {
    renderToggler();

    fireEvent.click(screen.getByRole('button', { name: '显示方式' }));

    const menu = screen.getByRole('menu');
    for (const label of ['关闭', '嵌字', '侧栏译文']) {
      expect(within(menu).getByText(label)).toBeTruthy();
    }
    for (const description of ['显示原始页面', '译文直接盖在气泡上', '译文排在页面两侧']) {
      expect(within(menu).getByText(description)).toBeTruthy();
    }
  });

  it('marks the current mode and selects a mode from the menu', () => {
    h.state = baseState('danmaku');
    renderToggler();

    fireEvent.click(screen.getByRole('button', { name: '显示方式' }));
    const menu = screen.getByRole('menu');

    expect(within(menu).getByRole('menuitem', { name: '侧栏译文 - ON' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '嵌字 - OFF' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: '嵌字 - OFF' }));
    expect(h.setMode).toHaveBeenCalledWith('bubble');
  });

  it('exposes the pressed state on the main button', () => {
    h.state = baseState('bubble');
    const { rerender } = renderToggler();

    expect(mainButton().getAttribute('aria-pressed')).toBe('true');

    h.state = baseState('off');
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));
    expect(mainButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('stays clickable while translating so the request can be cancelled', () => {
    h.state = { ...baseState('off'), loading: true };
    renderToggler();

    const button = mainButton();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(h.toggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the slot but drops the menu arrow on an image-less page', () => {
    h.state = baseState('bubble');
    const { rerender } = renderToggler();
    expect(screen.getByRole('button', { name: '显示方式' })).toBeTruthy();

    h.state = { ...baseState('bubble'), available: false };
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    expect(screen.queryByRole('button', { name: '显示方式' })).toBeNull();
    expect((mainButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the side column row and states why', () => {
    h.state = { ...baseState('bubble'), danmakuDisabledReason: 'narrow' };
    renderToggler();

    fireEvent.click(screen.getByRole('button', { name: '显示方式' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('需要更宽的窗口')).toBeTruthy();
    const row = within(menu).getByText('侧栏译文').closest('button');
    expect((row as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
