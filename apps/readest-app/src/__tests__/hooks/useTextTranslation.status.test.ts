import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';
import { eventDispatcher } from '@/utils/event';
import { resetTranslationCacheForTests } from '@/services/translators/translationCache';

const mocks = vi.hoisted(() => ({
  settings: {
    translationEnabled: true,
    translationProvider: 'deepl',
    translateTargetLang: 'EN',
    translationPromptId: undefined as string | undefined,
    showTranslateSource: false,
  },
  translate: vi.fn(),
  setLoading: vi.fn(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({
      getViewSettings: () => mocks.settings,
      setIsLoading: mocks.setLoading,
    }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({
      getBookData: () => ({ book: { title: 'Test Book', author: 'Tester' } }),
    }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => null,
  getBookProgress: () => null,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mocks.translate,
    translator: { name: 'deepl', concurrency: 5, preservesMarkup: false },
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (message: string, options?: Record<string, unknown>) =>
    message.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options?.[key] ?? '')),
}));

class ImmediateIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }

  disconnect() {}
  unobserve() {}
}

const BOOK_KEY = 'book-key';

const createView = (paragraphs: string[]) => {
  const view = document.createElement('div');
  for (const paragraph of paragraphs) {
    const element = document.createElement('p');
    element.textContent = paragraph;
    view.appendChild(element);
  }
  return view;
};

beforeEach(() => {
  resetTranslationCacheForTests();
  mocks.translate.mockReset();
  mocks.setLoading.mockReset();
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetTranslationCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTextTranslation task status', () => {
  test('writes a failure into the status bar instead of only logging it', async () => {
    const view = createView(['Broken paragraph']);
    mocks.translate.mockRejectedValue(new Error('service unavailable'));

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(result.current.status?.kind).toBe('error');
    });
    expect(result.current.status).toEqual({ kind: 'error', message: '这 1 段没翻成' });
  });

  test('counts only the paragraphs that failed', async () => {
    const view = createView(['Good paragraph', 'Broken paragraph']);
    mocks.translate.mockImplementation(async (texts: string[]) => {
      if (texts[0] === 'Broken paragraph') throw new Error('HTTP 500');
      return texts.map((text: string) => `Translated: ${text}`);
    });

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(result.current.status?.kind).toBe('error');
    });
    expect(result.current.status).toEqual({ kind: 'error', message: '这 1 段没翻成' });
    await waitFor(() => {
      expect(view.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Good paragraph',
      );
    });
  });

  test('retry re-requests the failed paragraph and clears the bar on success', async () => {
    const view = createView(['Retry paragraph']);
    mocks.translate.mockRejectedValueOnce(new Error('timeout'));

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(result.current.status?.kind).toBe('error');
    });
    expect(mocks.translate).toHaveBeenCalledTimes(1);

    mocks.translate.mockImplementation(async (texts: string[]) =>
      texts.map((text) => `Translated: ${text}`),
    );

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBeNull();
    });
    expect(mocks.translate).toHaveBeenCalledTimes(2);
    expect(mocks.translate).toHaveBeenLastCalledWith(['Retry paragraph']);
    expect(view.querySelector('.translation-target')?.textContent).toBe(
      'Translated: Retry paragraph',
    );
  });

  test('a successful translation never announces itself', async () => {
    const view = createView(['Fresh paragraph']);
    mocks.translate.mockImplementation(async (texts: string[]) =>
      texts.map((text) => `Translated: ${text}`),
    );
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(view.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Fresh paragraph',
      );
    });
    await waitFor(() => {
      expect(result.current.status).toBeNull();
    });

    expect(dispatch.mock.calls.some(([event]) => event === 'hint')).toBe(false);
  });
});
