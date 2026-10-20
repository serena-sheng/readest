import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TranslationToggler from '@/app/reader/components/TranslationToggler';

const mocks = vi.hoisted(() => ({
  book: { format: 'EPUB', primaryLanguage: 'zh-CN' } as {
    format: string;
    primaryLanguage: string;
  },
  settings: { translationEnabled: false, translateTargetLang: 'zh' },
  setViewSettings: vi.fn(),
  setHoveredBookKey: vi.fn(),
  openSettings: vi.fn(),
  setSettingsBookKey: vi.fn(),
  setActiveSettingsItemId: vi.fn(),
  saveViewSettings: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => mocks.settings,
    setViewSettings: mocks.setViewSettings,
    setHoveredBookKey: mocks.setHoveredBookKey,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: mocks.book }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      setSettingsDialogOpen: mocks.openSettings,
      setSettingsDialogBookKey: mocks.setSettingsBookKey,
      setActiveSettingsItemId: mocks.setActiveSettingsItemId,
    }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: () => 20,
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: mocks.saveViewSettings,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

beforeEach(() => {
  mocks.book = { format: 'EPUB', primaryLanguage: 'zh-CN' };
  mocks.settings = { translationEnabled: false, translateTargetLang: 'zh' };
  [
    mocks.setViewSettings,
    mocks.setHoveredBookKey,
    mocks.openSettings,
    mocks.setSettingsBookKey,
    mocks.setActiveSettingsItemId,
    mocks.saveViewSettings,
  ].forEach((mock) => mock.mockReset());
});

afterEach(() => {
  cleanup();
});

describe('TranslationToggler when the book cannot be translated', () => {
  it('stays clickable and explains the PDF limitation', () => {
    mocks.book = { format: 'PDF', primaryLanguage: 'en' };
    mocks.settings = { translationEnabled: false, translateTargetLang: 'zh' };
    render(<TranslationToggler bookKey='book-key' />);

    const button = screen.getByRole('button', { name: '为什么不能翻译' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.getAttribute('title')).toBe('为什么不能翻译');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(button);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('这本书不能翻译正文')).toBeTruthy();
    expect(screen.getByText('PDF 只支持整页阅读，不能翻译正文')).toBeTruthy();
  });

  it('explains that the book already uses the target language', () => {
    render(<TranslationToggler bookKey='book-key' />);

    fireEvent.click(screen.getByRole('button', { name: '为什么不能翻译' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('这本书已经是');
    expect(dialog.textContent).toContain('不需要翻译');
  });

  it('opens the target language setting from the explanation', () => {
    render(<TranslationToggler bookKey='book-key' />);

    fireEvent.click(screen.getByRole('button', { name: '为什么不能翻译' }));
    fireEvent.click(screen.getByRole('button', { name: '更换目标语言' }));

    expect(mocks.setSettingsBookKey).toHaveBeenCalledWith('book-key');
    expect(mocks.setActiveSettingsItemId).toHaveBeenCalledWith('settings.language.targetLanguage');
    expect(mocks.openSettings).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the explanation without changing settings', () => {
    render(<TranslationToggler bookKey='book-key' />);

    fireEvent.click(screen.getByRole('button', { name: '为什么不能翻译' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });
});
