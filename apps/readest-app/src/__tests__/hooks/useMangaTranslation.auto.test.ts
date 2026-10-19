import '../setupMemoryStorage';

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import { useMangaTranslation } from '@/app/reader/hooks/useMangaTranslation';
import { eventDispatcher } from '@/utils/event';

const h = vi.hoisted(() => ({
  getMangaEndpoint: vi.fn(),
  translate: vi.fn(),
  getGlossary: vi.fn(() => ({})),
  getMangaPage: vi.fn(),
  saveViewSettings: vi.fn(),
  location: 'loc-1',
  viewSettings: { mangaTranslationMode: 'off' } as Record<string, unknown> | null,
}));

vi.mock('@/services/translators/endpoints', () => ({
  getMangaEndpoint: h.getMangaEndpoint,
}));
vi.mock('@/services/manga/translateMangaPage', () => ({
  translateMangaPage: h.translate,
}));
vi.mock('@/services/translators/glossary', () => ({
  getGlossary: h.getGlossary,
}));
vi.mock('@/services/manga/mangaCache', () => ({
  getMangaPage: h.getMangaPage,
  makeMangaCacheKey: (...parts: string[]) => parts.join('|'),
  glossaryRevision: () => 'rev',
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: h.location }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getViewSettings: () => h.viewSettings }) },
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.saveViewSettings }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    key.replace('{{count}}', String(options?.['count'] ?? '')),
}));

const endpoint = { baseUrl: 'https://vision.example.com/v1', model: 'vision-1' };
const page: MangaPageResult = {
  width: 900,
  height: 1200,
  bubbles: [{ box: [10, 20, 50, 100], src: '原文', dst: '译文', vertical: false }],
};

const rect = (width: number, height: number): DOMRect => ({
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  width,
  height,
  right: width,
  bottom: height,
  toJSON: () => ({}),
});

let container: HTMLDivElement;
let view: FoliateView;

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  blob: async () => ({
    type: 'image/jpeg',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }),
}));

const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

const toastCalls = () =>
  dispatchSpy.mock.calls
    .map(([, payload]) => payload)
    .filter(
      (payload): payload is { type?: unknown; message?: unknown } =>
        typeof payload === 'object' && payload !== null,
    );

const addImage = (
  src: string,
  rendered: { width: number; height: number } = { width: 900, height: 1200 },
): HTMLImageElement => {
  const image = document.createElement('img');
  image.src = src;
  Object.defineProperty(image, 'naturalWidth', {
    value: rendered.width,
    configurable: true,
  });
  Object.defineProperty(image, 'naturalHeight', {
    value: rendered.height,
    configurable: true,
  });
  image.getBoundingClientRect = () => rect(rendered.width, rendered.height);
  container.appendChild(image);
  return image;
};

const makeView = () =>
  ({
    renderer: { getContents: () => [{ doc: document, index: 0 }] },
  }) as unknown as FoliateView;

beforeEach(() => {
  h.getMangaEndpoint.mockReset().mockReturnValue(endpoint);
  h.translate.mockReset().mockResolvedValue(page);
  h.getGlossary.mockReset().mockReturnValue({});
  h.getMangaPage.mockReset().mockResolvedValue(null);
  h.saveViewSettings.mockReset();
  h.location = 'loc-1';
  h.viewSettings = { mangaTranslationMode: 'off' };
  dispatchSpy.mockClear();
  fetchMock.mockClear();

  // jsdom has no requestIdleCallback; make the scheduled fallback deterministic.
  // The cast is only for deleting a browser API the DOM lib declares optional.
  const idleWindow = window as unknown as { requestIdleCallback?: unknown };
  idleWindow.requestIdleCallback = undefined;

  container = document.createElement('div');
  document.body.appendChild(container);
  view = makeView();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMangaTranslation automatic page translation', () => {
  it('translates the current page when the restored mode is bubble', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    addImage('https://example.com/manga/page-01.jpg');

    const { result } = renderHook(() => useMangaTranslation('book-1', view));

    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.result).toEqual(page));
    expect(result.current.mode).toBe('bubble');
    expect(h.translate).toHaveBeenCalledWith(
      expect.objectContaining({ width: 900, height: 1200, targetLang: 'zh-Hans' }),
    );
  });

  it('translates the new page after a page change', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    const image = addImage('https://example.com/manga/page-01.jpg');

    const { rerender } = renderHook(() => useMangaTranslation('book-1', view));
    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(1));

    image.src = 'https://example.com/manga/page-02.jpg';
    image.getBoundingClientRect = () => rect(800, 1100);
    Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 1100, configurable: true });
    h.location = 'loc-2';
    rerender();

    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(2));
    expect(h.translate.mock.calls[1]![0]).toMatchObject({ width: 800, height: 1100 });
  });

  it('renders a cached page without a loading state or a request', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    h.getMangaPage.mockResolvedValue(page);
    addImage('https://example.com/manga/page-01.jpg');

    const loadingHistory: boolean[] = [];
    const { result } = renderHook(() => {
      const state = useMangaTranslation('book-1', view);
      loadingHistory.push(state.loading);
      return state;
    });

    await waitFor(() => expect(result.current.result).toEqual(page));
    expect(loadingHistory).not.toContain(true);
    expect(result.current.loading).toBe(false);
    expect(h.translate).not.toHaveBeenCalled();
  });

  it('prefetches exactly the next page after the current one finishes', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    addImage('https://example.com/manga/page-01.jpg', { width: 900, height: 1200 });
    addImage('https://example.com/manga/page-02.jpg', { width: 800, height: 1100 });

    renderHook(() => useMangaTranslation('book-1', view));

    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(2));
    expect(h.translate.mock.calls[0]![0]).toMatchObject({ width: 900, height: 1200 });
    expect(h.translate.mock.calls[1]![0]).toMatchObject({ width: 800, height: 1100 });
    expect(toastCalls().filter((payload) => payload.type === 'error')).toHaveLength(0);
  });

  it('aborts the in-flight prefetch when the page changes', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    addImage('https://example.com/manga/page-01.jpg', { width: 900, height: 1200 });
    addImage('https://example.com/manga/page-02.jpg', { width: 800, height: 1100 });

    const prefetchSignals: AbortSignal[] = [];
    h.translate.mockImplementation((args: { signal?: AbortSignal }) => {
      if (h.translate.mock.calls.length === 1) return Promise.resolve(page);
      if (h.translate.mock.calls.length === 2) {
        const { promise, reject } = Promise.withResolvers<MangaPageResult>();
        const signal = args.signal!;
        prefetchSignals.push(signal);
        signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        return promise;
      }
      return Promise.resolve(page);
    });

    const { rerender } = renderHook(() => useMangaTranslation('book-1', view));
    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(2));
    expect(prefetchSignals).toHaveLength(1);

    h.location = 'loc-2';
    rerender();

    await waitFor(() => expect(prefetchSignals[0]!.aborted).toBe(true));
  });

  it('keeps the UI unchanged when the prefetch fails', async () => {
    h.viewSettings = { mangaTranslationMode: 'bubble' };
    addImage('https://example.com/manga/page-01.jpg', { width: 900, height: 1200 });
    addImage('https://example.com/manga/page-02.jpg', { width: 800, height: 1100 });

    h.translate
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(new Error('manga: HTTP 500'));

    const { result } = renderHook(() => useMangaTranslation('book-1', view));

    await waitFor(() => expect(h.translate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.result).toEqual(page);
    expect(toastCalls().filter((payload) => payload.type === 'error')).toHaveLength(0);
    expect(
      toastCalls().filter((payload) => String(payload.message).includes('HTTP 500')),
    ).toHaveLength(0);
  });

  it('never translates automatically while the mode is off', async () => {
    addImage('https://example.com/manga/page-01.jpg');

    const { result } = renderHook(() => useMangaTranslation('book-1', view));
    await waitFor(() => expect(result.current.available).toBe(true));

    // An automatic translation is started synchronously from the page effect,
    // so reaching this point without a call proves the mode gate held.
    expect(h.translate).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('off');
    expect(result.current.loading).toBe(false);
  });

  it('writes the chosen mode back to the book view settings', async () => {
    addImage('https://example.com/manga/page-01.jpg');

    const { result } = renderHook(() => useMangaTranslation('book-1', view));
    await waitFor(() => expect(result.current.available).toBe(true));

    await result.current.cycleMode();
    await waitFor(() => expect(result.current.mode).toBe('bubble'));
    expect(h.saveViewSettings).toHaveBeenCalledWith(
      {},
      'book-1',
      'mangaTranslationMode',
      'bubble',
      true,
      false,
    );

    await result.current.cycleMode();
    await waitFor(() => expect(result.current.mode).toBe('danmaku'));
    expect(h.saveViewSettings).toHaveBeenCalledWith(
      {},
      'book-1',
      'mangaTranslationMode',
      'danmaku',
      true,
      false,
    );
  });
});
