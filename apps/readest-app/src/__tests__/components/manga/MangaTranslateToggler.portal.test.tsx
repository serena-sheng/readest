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

const trigger = () =>
  screen.getByRole('button', { name: /翻译这一页的漫画文字|漫画翻译：|本页没有可翻译的图片/ });

const triggerRect = (left: number, right: number, bottom: number) => ({
  x: left,
  y: bottom - 32,
  left,
  right,
  top: bottom - 32,
  bottom,
  width: right - left,
  height: 32,
  toJSON: () => ({}),
});

beforeEach(() => {
  h.state = baseState('off');
  h.toggle.mockReset();
  h.setMode.mockReset();
});

afterEach(cleanup);

describe('MangaTranslateToggler menu portal', () => {
  it('renders the menu under document.body so the header scroller cannot clip it', () => {
    const { container } = render(
      React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }),
    );

    fireEvent.click(trigger());

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.className).toContain('fixed');
  });

  it('places the menu 6px below the trigger and clamps it inside the viewport', () => {
    render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    const button = trigger();
    button.getBoundingClientRect = () => triggerRect(900, 932, 42) as DOMRect;
    fireEvent.click(button);

    const menu = screen.getByRole('menu');
    // 932 - 248 = 684: right-aligned because 900 + 248 overflows 1024 - 16.
    expect(menu.style.left).toBe('684px');
    expect(menu.style.top).toBe('48px');

    fireEvent.click(button);
    button.getBoundingClientRect = () => triggerRect(4, 36, 42) as DOMRect;
    fireEvent.click(button);
    expect(screen.getByRole('menu').style.left).toBe('16px');
  });

  it('switches translation from the first row of the portalled menu', () => {
    render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    const firstRow = within(menu).getAllByRole('menuitem')[0]!;

    expect(firstRow.getAttribute('aria-label')).toBe('开启漫画翻译 - OFF');
    fireEvent.click(firstRow);

    expect(h.toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
