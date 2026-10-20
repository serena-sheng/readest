import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

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
// The scope now carries the glossary revision (`|g0` with no stored glossary).
const keyFor = (text: string) => makeTranslationKey(BOOK_KEY, 'EN', 'deepl||g0', text);

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
    // The tint belongs to a wrapper around the original text only — the
    // paragraph container also holds the translation, which must stay plain.
    expect(paragraph.classList.contains('translation-source-done')).toBe(false);
    // With the source hidden the tint wrapper sits inside the hidden wrapper,
    // so look it up as a descendant rather than a direct child.
    const tint = paragraph.querySelector('.translation-source-tint');
    expect(tint?.classList.contains('translation-source-done')).toBe(true);
    expect(tint?.querySelector('.translation-target')).toBeNull();
    expect(tint?.textContent).toBe('Marker paragraph');
  });

  test('reports progress through the task status and leaves success silent', async () => {
    let resolveTranslate!: (texts: string[]) => void;
    mocks.translate.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveTranslate = resolve;
        }),
    );
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    const view = createView(['Progress paragraph']);

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(result.current.status?.kind).toBe('progress');
    });

    await act(async () => {
      resolveTranslate(['Translated: Progress paragraph']);
    });

    await waitFor(() => {
      expect(view.querySelector('.translation-target')).toBeTruthy();
      expect(result.current.status).toBeNull();
    });

    const hints = dispatch.mock.calls.filter(([name]) => name === 'hint');
    expect(hints).toEqual([]);
    dispatch.mockRestore();
  });

  test('never sends a filename to the translator', async () => {
    const view = createView(['page03.png']);

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mocks.translate).not.toHaveBeenCalled();
    expect(view.querySelector('.translation-target')).toBeNull();
  });

  test('discards a reply that answers the request instead of translating', async () => {
    mocks.translate.mockImplementation(async () =>
      Promise.resolve(["I don't see any text to translate — please paste the text."]),
    );
    const view = createView(['Some real prose goes here.']);

    renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => expect(mocks.translate).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(view.querySelector('.translation-target')).toBeNull();
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
