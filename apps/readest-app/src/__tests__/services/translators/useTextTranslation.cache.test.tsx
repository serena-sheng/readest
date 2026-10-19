import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';
import { eventDispatcher } from '@/utils/event';
import {
  getTranslation,
  makeTranslationKey,
  resetTranslationCacheForTests,
  setTranslation,
} from '@/services/translators/translationCache';

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
  useTranslation: () => (message: string) => message,
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
const keyFor = (text: string) => makeTranslationKey(BOOK_KEY, 'EN', 'deepl|', text);

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
  mocks.translate.mockImplementation(async (texts: string[]) =>
    texts.map((text) => `Translated: ${text}`),
  );
  mocks.setLoading.mockReset();
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
});

afterEach(() => {
  cleanup();
  resetTranslationCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTextTranslation cache integration', () => {
  test('renders a cached paragraph without calling the provider', async () => {
    const view = createView(['Cached paragraph']);
    await setTranslation(keyFor('Cached paragraph'), 'Cached translation');

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(view.querySelector('.translation-target')?.textContent).toBe('Cached translation');
    });
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  test('translates a miss once and stores the result', async () => {
    const view = createView(['Fresh paragraph']);

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(view.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Fresh paragraph',
      );
    });
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenCalledWith(['Fresh paragraph']);
    expect(await getTranslation(keyFor('Fresh paragraph'))).toBe('Translated: Fresh paragraph');
  });

  test('marks the original paragraph as translated', async () => {
    const view = createView(['Marker paragraph']);

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(view.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Marker paragraph',
      );
    });
    const paragraph = view.querySelector('p')!;
    expect(paragraph.classList.contains('translation-source')).toBe(true);
    expect(paragraph.classList.contains('translation-source-done')).toBe(true);
  });

  test('reports progress and completion through the hint channel', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    const view = createView(['Progress paragraph']);

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(view.querySelector('.translation-target')).toBeTruthy();
    });

    const hints = dispatch.mock.calls
      .filter(([name]) => name === 'hint')
      .map(([, detail]) => (detail as { message: string }).message);
    expect(hints.some((message) => message.startsWith('Translating '))).toBe(true);
    expect(hints.some((message) => message.startsWith('Translation ready'))).toBe(true);
    dispatch.mockRestore();
  });

  test('shows the stored translation directly after reopening the book', async () => {
    const firstView = createView(['Remembered paragraph']);
    const firstMount = renderHook(() => useTextTranslation(BOOK_KEY, firstView));

    await waitFor(() => {
      expect(firstView.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Remembered paragraph',
      );
    });
    expect(mocks.translate).toHaveBeenCalledTimes(1);

    firstMount.unmount();
    mocks.translate.mockClear();

    const reopenedView = createView(['Remembered paragraph']);
    renderHook(() => useTextTranslation(BOOK_KEY, reopenedView));

    await waitFor(() => {
      expect(reopenedView.querySelector('.translation-target')?.textContent).toBe(
        'Translated: Remembered paragraph',
      );
    });
    expect(mocks.translate).not.toHaveBeenCalled();
  });
});
