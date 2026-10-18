import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import TypesetPanel from '@/app/reader/components/TypesetPanel';
import { getComicViewDefaults, hasViewSettingOverrides } from '@/utils/comic';

const mocks = vi.hoisted(() => {
  const viewSettings = {
    defaultFontSize: 16,
    lineHeight: 1.6,
    marginTopPx: 44,
    defaultFont: 'Serif',
    serifFont: 'Bitter',
    sansSerifFont: 'Roboto',
    maxColumnCount: 1,
    maxInlineSize: 720,
    spreadMode: 'none',
    zoomMode: 'fit-page',
    webtoonMode: false,
    scrolled: false,
    scrolledDirection: 'vertical',
    zoomLevel: 100,
    writingMode: 'horizontal-tb',
    vertical: false,
  };
  const bookData = {
    isFixedLayout: true,
    book: { format: 'CBZ' },
    docFormat: 'CBZ',
  };
  return {
    viewSettings,
    bookData,
    saveViewSettings: vi.fn().mockResolvedValue(undefined),
    setThemeColor: vi.fn(),
    setThemeMode: vi.fn(),
    recreateViewer: vi.fn(),
    getView: vi.fn(() => null),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: undefined }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: mocks.saveViewSettings,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: mocks.getView,
    getViewSettings: () => mocks.viewSettings,
    recreateViewer: mocks.recreateViewer,
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: mocks.viewSettings },
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: { getBookData: () => unknown }) => unknown) =>
    selector({ getBookData: () => mocks.bookData }),
}));

vi.mock('@/store/themeStore', () => {
  const state = {
    themeColor: 'emm',
    themeMode: 'light',
    isDarkMode: false,
    setThemeColor: mocks.setThemeColor,
    setThemeMode: mocks.setThemeMode,
  };
  return { useThemeStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  applyPageTurnAttributes: vi.fn(),
}));

const renderPanel = () => {
  render(<TypesetPanel bookKey='book-1' title='漫画' open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: '排版' }));
};

beforeEach(() => {
  Object.assign(mocks.viewSettings, {
    spreadMode: 'none',
    webtoonMode: false,
    scrolled: false,
    scrolledDirection: 'vertical',
    zoomLevel: 100,
    writingMode: 'horizontal-tb',
    vertical: false,
    maxColumnCount: 1,
  });
  mocks.bookData.book.format = 'CBZ';
  mocks.bookData.docFormat = 'CBZ';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TypesetPanel manga block', () => {
  it('shows the single-page default and writes it back when leaving 条漫', () => {
    renderPanel();

    expect(screen.getByRole('radio', { name: '单页' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '条漫' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('radio', { name: '条漫' }));
    fireEvent.click(screen.getByRole('radio', { name: '单页' }));

    // Single page is `spreadMode: 'none'` for a fixed-layout book, matching
    // the View menu's Single Page button; it is written per book.
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'spreadMode',
      'none',
      true,
      false,
    ]);
  });

  it('writes the webtoon mode and its scrolled flow when 条漫 is chosen', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: '条漫' }));

    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'webtoonMode',
      true,
      true,
      false,
    ]);
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'scrolled',
      true,
      true,
      false,
    ]);
  });

  it('writes the right-to-left writing mode when 从右到左 is chosen', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: '从右到左' }));

    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'writingMode',
      'horizontal-rl',
      true,
    ]);
    await waitFor(() => expect(mocks.recreateViewer).toHaveBeenCalledWith({}, 'book-1'));
  });

  it('offers the double-page switch only in single-page mode and writes the spread', () => {
    renderPanel();

    expect(screen.getByRole('switch', { name: '双页' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: '双页' }));
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'spreadMode',
      'auto',
      true,
      false,
    ]);

    fireEvent.click(screen.getByRole('radio', { name: '条漫' }));
    expect(screen.queryByRole('switch', { name: '双页' })).toBeNull();
  });

  it('shows the unsupported notice instead of controls for a non-comic book', () => {
    mocks.bookData.book.format = 'EPUB';
    mocks.bookData.docFormat = 'EPUB';

    renderPanel();

    expect(screen.getByText('本书不支持漫画模式')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: '漫画模式' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '阅读方向' })).toBeNull();
  });
});

describe('comic view defaults', () => {
  it('defaults a CBZ to single page, fit page and the book direction', () => {
    expect(getComicViewDefaults('rtl')).toEqual({
      spreadMode: 'none',
      zoomMode: 'fit-page',
      webtoonMode: false,
      scrolled: false,
      maxColumnCount: 1,
      writingMode: 'horizontal-rl',
    });
    expect(getComicViewDefaults(undefined).writingMode).toBe('horizontal-tb');
  });

  it('only reports overrides when a stored value differs from the baseline', () => {
    const baseline = { spreadMode: 'auto', webtoonMode: false, isGlobal: true } as const;
    expect(hasViewSettingOverrides({ ...baseline }, baseline)).toBe(false);
    expect(hasViewSettingOverrides({ ...baseline, webtoonMode: true }, baseline)).toBe(true);
  });
});
