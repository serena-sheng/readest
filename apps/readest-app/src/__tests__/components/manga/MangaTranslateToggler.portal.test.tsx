import '../../setupMemoryStorage';

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MangaTranslationMode } from '@/app/reader/hooks/useMangaTranslation';
import MangaTranslateToggler from '@/app/reader/components/manga/MangaTranslateToggler';
import { MANGA_CONTROL_EDGE } from '@/app/reader/components/manga/MangaControlCluster';

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
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
  toggle: vi.fn(),
  setMode: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  retranslate: vi.fn(),
  dismissStatus: vi.fn(),
  dismissModelSetup: vi.fn(),
  fitPage: vi.fn(),
});

beforeEach(() => {
  window.localStorage.clear();
  h.state = baseState('off');
  const host = document.createElement('div');
  host.id = 'gridcell-book-1';
  document.body.appendChild(host);
});

afterEach(() => {
  cleanup();
  document.getElementById('gridcell-book-1')?.remove();
});

describe('MangaTranslateToggler page-level cluster', () => {
  it('renders the cluster inside the reading area, not in the header slot', () => {
    const { container } = render(
      React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }),
    );

    const host = document.getElementById('gridcell-book-1')!;
    const cluster = screen.getByTestId('manga-control-cluster');
    expect(host.contains(cluster)).toBe(true);
    expect(container.contains(cluster)).toBe(false);
    expect(container.childElementCount).toBe(0);
  });

  it('pins the cluster 24px from the reading area bottom-right corner', () => {
    render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    const cluster = screen.getByTestId('manga-control-cluster');
    expect(cluster.style.bottom).toBe(`${MANGA_CONTROL_EDGE}px`);
    expect(cluster.style.right).toBe(`${MANGA_CONTROL_EDGE}px`);
    expect(cluster.className).toContain('absolute');
  });

  it('keeps the cluster after a manga page was seen, even on an image-less page', () => {
    const { rerender } = render(
      React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }),
    );
    expect(screen.queryByTestId('manga-control-cluster')).not.toBeNull();

    h.state = { ...baseState('off'), available: false };
    rerender(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    expect(screen.queryByTestId('manga-control-cluster')).not.toBeNull();
  });

  it('renders nothing before a manga page has ever been seen', () => {
    h.state = { ...baseState('off'), available: false };
    render(React.createElement(MangaTranslateToggler, { bookKey: 'book-1', view: null }));

    expect(screen.queryByTestId('manga-control-cluster')).toBeNull();
  });
});
