import '../setupMemoryStorage';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import {
  MANGA_NARROW_NOTICE,
  useMangaTranslation,
} from '@/app/reader/hooks/useMangaTranslation';

const h = vi.hoisted(() => ({
  getMangaEndpoint: vi.fn(),
  translate: vi.fn(),
  getGlossary: vi.fn(() => ({})),
  saveViewSettings: vi.fn(),
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
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.saveViewSettings }));

const endpoint = { baseUrl: 'https://vision.example.com/v1', model: 'vision-1' };
const page: MangaPageResult = {
  width: 800,
  height: 1200,
  bubbles: [{ box: [100, 200, 400, 500], src: '原文', dst: '译文', vertical: false }],
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
let image: HTMLImageElement;
let view: FoliateView;

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  blob: async () => ({
    type: 'image/jpeg',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }),
}));

const setContentWidth = (width: number) => {
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
};

beforeEach(() => {
  h.getMangaEndpoint.mockReset().mockReturnValue(endpoint);
  h.translate.mockReset().mockResolvedValue(page);
  h.getGlossary.mockReset().mockReturnValue({});
  h.saveViewSettings.mockReset();
  fetchMock.mockClear();

  container = document.createElement('div');
  document.body.appendChild(container);
  setContentWidth(800);

  image = document.createElement('img');
  image.src = 'https://example.com/manga/page-01.jpg';
  Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 1200, configurable: true });
  image.getBoundingClientRect = () => rect(800, 1200);
  container.appendChild(image);

  view = {
    renderer: { getContents: () => [{ doc: document, index: 0 }] },
  } as unknown as FoliateView;

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMangaTranslation narrow-window fallback', () => {
  it('falls back to bubbles and reports the reason once', async () => {
    setContentWidth(320);
    const onNarrowFallback = vi.fn();
    const { result } = renderHook(() =>
      useMangaTranslation('book-1', view, { onNarrowFallback }),
    );

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.danmakuDisabledReason).toBe('narrow');

    await act(async () => {
      await result.current.setMode('danmaku');
    });
    await waitFor(() => expect(result.current.mode).toBe('bubble'));

    expect(h.saveViewSettings).toHaveBeenCalledWith(
      {},
      'book-1',
      'mangaTranslationMode',
      'bubble',
      true,
      false,
    );

    await act(async () => {
      await result.current.setMode('danmaku');
    });

    expect(onNarrowFallback).toHaveBeenCalledTimes(1);
    expect(onNarrowFallback).toHaveBeenCalledWith(MANGA_NARROW_NOTICE);
  });

  it('keeps the side column enabled when the reading area has room', async () => {
    const { result } = renderHook(() => useMangaTranslation('book-1', view));

    await waitFor(() => expect(result.current.available).toBe(true));

    expect(result.current.danmakuDisabledReason).toBeNull();
    await act(async () => {
      await result.current.setMode('danmaku');
    });
    await waitFor(() => expect(result.current.mode).toBe('danmaku'));
  });

  it('disables the side column for long-strip pages', async () => {
    Object.defineProperty(image, 'naturalHeight', { value: 2400, configurable: true });
    image.getBoundingClientRect = () => rect(800, 2400);
    const onNarrowFallback = vi.fn();
    const { result } = renderHook(() =>
      useMangaTranslation('book-1', view, { onNarrowFallback }),
    );

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.danmakuDisabledReason).toBe('tall');

    await act(async () => {
      await result.current.setMode('danmaku');
    });
    await waitFor(() => expect(result.current.mode).toBe('bubble'));
    expect(onNarrowFallback).not.toHaveBeenCalled();
  });
});
