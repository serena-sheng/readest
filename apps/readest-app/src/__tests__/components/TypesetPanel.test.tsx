import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import TypesetPanel from '@/app/reader/components/TypesetPanel';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => {
  const viewSettings = {
    defaultFontSize: 16,
    lineHeight: 1.6,
    marginTopPx: 44,
    defaultFont: 'Serif',
    serifFont: 'Bitter',
    sansSerifFont: 'Roboto',
    maxColumnCount: 1,
    writingMode: 'horizontal-tb',
    vertical: false,
  };
  return {
    viewSettings,
    saveViewSettings: vi.fn(),
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

const renderPanel = () => {
  const onClose = vi.fn();
  render(<TypesetPanel bookKey='book-1' title='往事与随想' open onClose={onClose} />);
  return { onClose };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TypesetPanel', () => {
  it('renders the four tabs and swaps their content', () => {
    renderPanel();

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '外观',
      '字体',
      '排版',
      '主题包',
    ]);
    expect(screen.getByRole('radiogroup', { name: '主题色' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '深浅' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '字体' }));
    expect(screen.getByLabelText('字体名称')).toBeTruthy();
    expect(screen.getByLabelText('字号')).toBeTruthy();
    expect(screen.getByLabelText('行距')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '排版' }));
    expect(screen.getByLabelText('页边距')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '分栏' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '书写方向' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '主题包' }));
    expect(screen.getByRole('button', { name: /暖纸/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /夜读/ })).toBeTruthy();
  });

  it('applies a theme swatch through setThemeColor', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: 'Nord' }));

    expect(mocks.setThemeColor).toHaveBeenCalledWith('nord');
  });

  it('writes the font size back to the book view settings', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: '字体' }));

    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '20' } });

    expect(mocks.saveViewSettings).toHaveBeenCalledWith({}, 'book-1', 'defaultFontSize', 20);
  });

  it('applies a theme package in one click: palette, mode, type and margins', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: '主题包' }));

    fireEvent.click(screen.getByRole('button', { name: /夜读/ }));

    expect(mocks.setThemeColor).toHaveBeenCalledWith('nord');
    expect(mocks.setThemeMode).toHaveBeenCalledWith('dark');
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([{}, 'book-1', 'defaultFontSize', 16]);
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([{}, 'book-1', 'lineHeight', 1.8]);
    // 44/100 of the 88px range is the drawer's margin slider unit.
    expect(mocks.saveViewSettings.mock.calls).toContainEqual([
      {},
      'book-1',
      'marginTopPx',
      39,
      false,
      false,
    ]);
  });

  it('yields the shared drawer slot when a sibling opens', async () => {
    const { onClose } = renderPanel();

    await eventDispatcher.dispatch('ideas-close', { bookKey: 'book-1' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
