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
  it('opens the menu from the main button instead of toggling immediately', () => {
    renderToggler();

    const button = mainButton();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);

    expect(h.toggle).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('switches translation from the first menu row', () => {
    renderToggler();

    fireEvent.click(mainButton());
    const menu = screen.getByRole('menu');
    const toggleRow = within(menu).getAllByRole('menuitem')[0]!;
    expect(toggleRow.getAttribute('aria-label')).toBe('开启漫画翻译 - OFF');

    fireEvent.click(toggleRow);

    expect(h.toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with the display modes and their descriptions', () => {
    renderToggler();

    fireEvent.click(mainButton());

    const menu = screen.getByRole('menu');
    for (const label of ['开启漫画翻译', '盖在原文上', '排在两侧']) {
      expect(within(menu).getByText(label)).toBeTruthy();
    }
    for (const description of [
      '译文直接盖住气泡',
      '译文排在画面左右两栏',
    ]) {
      expect(within(menu).getByText(description)).toBeTruthy();
    }
  });

  it('marks the current mode and selects a mode from the menu', () => {
    h.state = baseState('danmaku');
    renderToggler();

    fireEvent.click(mainButton());
    const menu = screen.getByRole('menu');

    expect(within(menu).getByRole('menuitem', { name: '排在两侧 - ON' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '盖在原文上 - OFF' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: '盖在原文上 - OFF' }));
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
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('keeps the slot but disables the menu on an image-less page', () => {
    h.state = baseState('bubble');
    const { rerender } = renderToggler();
    expect(mainButton()).toBeTruthy();

    h.state = { ...baseState('bubble'), available: false };
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    const button = mainButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables the side column row and states why', () => {
    h.state = { ...baseState('bubble'), danmakuDisabledReason: 'narrow' };
    renderToggler();

    fireEvent.click(mainButton());

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('窗口太窄，放不下两侧译文')).toBeTruthy();
    const row = within(menu).getByText('排在两侧').closest('button');
    expect((row as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
