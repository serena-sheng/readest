import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useTextTranslation, describeTranslationFailure } from '@/app/reader/hooks/useTextTranslation';
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
    expect(result.current.status).toEqual({
      kind: 'error',
      message: 'service unavailable',
      detail: '1 段未完成',
    });
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
    expect(result.current.status).toEqual({
      kind: 'error',
      message: 'HTTP 500',
      detail: '1 段未完成',
    });
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

describe('translation failure reasons', () => {
  const baseUrl = 'http://127.0.0.1:8790';

  test('names a rejected API key instead of the HTTP status', () => {
    expect(describeTranslationFailure(new Error('emm: HTTP 401'), { baseUrl })).toEqual({
      key: 'API Key 被拒',
    });
    expect(describeTranslationFailure(new Error('emm: HTTP 403'), { baseUrl })).toEqual({
      key: 'API Key 被拒',
    });
  });

  test('reads the status code the OpenAI-compatible layer throws', () => {
    expect(
      describeTranslationFailure(
        Object.assign(new Error('Bad Request'), { statusCode: 401 }),
        { baseUrl },
      ),
    ).toEqual({ key: 'API Key 被拒' });
    expect(describeTranslationFailure(new Error('Unauthorized'), { providerLabel: 'DeepL' })).toEqual(
      { key: 'API Key 被拒' },
    );
  });

  test('names rate limiting', () => {
    expect(describeTranslationFailure(new Error('emm: HTTP 429'), { baseUrl })).toEqual({
      key: '请求太频繁',
    });
    expect(
      describeTranslationFailure(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }), {
        baseUrl,
      }),
    ).toEqual({ key: '请求太频繁' });
  });

  test('names a timeout', () => {
    expect(
      describeTranslationFailure(new Error('Translation request timed out'), { baseUrl }),
    ).toEqual({ key: '请求超时' });
    expect(describeTranslationFailure(new Error('AbortError'), { baseUrl })).toEqual({
      key: '请求超时',
    });
    expect(describeTranslationFailure(new DOMException('x', 'AbortError'), { baseUrl })).toEqual({
      key: '请求超时',
    });
  });

  test('names the service it cannot reach and keeps its address', () => {
    expect(
      describeTranslationFailure(new Error(`emm: 翻译端点不可用（${baseUrl}）`), { baseUrl }),
    ).toEqual({ key: '连不上 {{baseUrl}}', values: { baseUrl } });
  });

  test('names the provider instead of a local address it never contacts', () => {
    const reason = describeTranslationFailure(new TypeError('Failed to fetch'), {
      providerLabel: 'DeepL',
    });
    expect(reason).toEqual({ key: '连不上 {{provider}}', values: { provider: 'DeepL' } });
    expect(JSON.stringify(reason)).not.toContain('127.0.0.1');
  });

  test('falls back to the provider text without its emm prefix', () => {
    expect(describeTranslationFailure(new Error('emm: 模型响应为空'), { baseUrl })).toEqual({
      key: '模型响应为空',
    });
  });

  test('shows the reason as the message and the count as the detail', async () => {
    const view = createView(['Rejected paragraph']);
    mocks.translate.mockRejectedValue(new Error('emm: HTTP 401'));

    const { result } = renderHook(() => useTextTranslation(BOOK_KEY, view));

    await waitFor(() => {
      expect(result.current.status?.kind).toBe('error');
    });
    expect(result.current.status).toEqual({
      kind: 'error',
      message: 'API Key 被拒',
      detail: '1 段未完成',
    });
  });
});
