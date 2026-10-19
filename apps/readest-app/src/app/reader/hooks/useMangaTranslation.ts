'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import { hashBytes } from '@/services/manga/imageHash';
import { getMangaPage, glossaryRevision, makeMangaCacheKey } from '@/services/manga/mangaCache';
import { normalizeMangaTargetLang } from '@/services/manga/types';
import { translateMangaPage } from '@/services/manga/translateMangaPage';
import { getMangaEndpoint } from '@/services/translators/endpoints';
import { getGlossary } from '@/services/translators/glossary';
import { useBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import type { MangaTranslationMode } from '@/types/book';

export type { MangaTranslationMode } from '@/types/book';

/** A page image smaller than this on its short rendered side is a thumbnail,
 *  not a manga page, and is not offered for translation. */
export const MIN_MANGA_IMAGE_SHORT_SIDE = 300;

/**
 * How many pages after the visible one are translated in the background.
 * The budget is deliberately tiny: one page of look-ahead keeps a page turn
 * instant without spending requests on a book the reader may close.
 */
export const MANGA_PREFETCH_PAGES = 1;

const SUPPORTED_MIME_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
};
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Blob MIME first, then the URL's extension; the vision service rejects
 *  anything it cannot send, so an unknown extension falls back to JPEG. */
export const resolveMangaImageMimeType = (blobType: string, src: string): string => {
  const normalized = blobType.trim().toLowerCase();
  if (SUPPORTED_MIME_TYPES[normalized]) return normalized;

  const path = src.split(/[?#]/)[0] ?? '';
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? (normalized || 'image/jpeg');
};

/**
 * The largest image that is actually on screen in the current section. Foliate
 * keeps neighbouring pages in the same document, so intersection with the
 * iframe viewport is what separates "this page" from "the next one".
 */
const pickPageImage = (view: FoliateView | null): HTMLImageElement | null => {
  const contents = view?.renderer?.getContents?.() ?? [];
  let best: HTMLImageElement | null = null;
  let bestArea = 0;

  for (const { doc } of contents) {
    if (!doc) continue;
    const window = doc.defaultView;
    const viewportWidth = window?.innerWidth ?? Number.POSITIVE_INFINITY;
    const viewportHeight = window?.innerHeight ?? Number.POSITIVE_INFINITY;

    for (const image of Array.from(doc.querySelectorAll('img'))) {
      const rect = image.getBoundingClientRect();
      if (Math.min(rect.width, rect.height) < MIN_MANGA_IMAGE_SHORT_SIDE) continue;
      if (rect.bottom <= 0 || rect.right <= 0) continue;
      if (rect.top >= viewportHeight || rect.left >= viewportWidth) continue;

      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = image;
        bestArea = area;
      }
    }
  }
  return best;
};

/** True when the image is a full page rather than a thumbnail or ornament.
 *  Offscreen pages may not be laid out yet, so intrinsic dimensions count. */
const isPageImage = (image: HTMLImageElement): boolean => {
  const rect = image.getBoundingClientRect();
  if (Math.min(rect.width, rect.height) >= MIN_MANGA_IMAGE_SHORT_SIDE) return true;
  return Math.min(image.naturalWidth || 0, image.naturalHeight || 0) >= MIN_MANGA_IMAGE_SHORT_SIDE;
};

/**
 * Images after `current` in document order, limited to the prefetch budget.
 * Foliate lays neighbouring pages into the same document, so this is the page
 * the reader will see next without waiting for a new section.
 */
const pickFollowingPageImages = (
  view: FoliateView | null,
  current: HTMLImageElement,
  count: number,
): HTMLImageElement[] => {
  if (count <= 0) return [];
  const contents = view?.renderer?.getContents?.() ?? [];

  for (const { doc } of contents) {
    if (!doc) continue;
    const images = Array.from(doc.querySelectorAll('img')).filter(isPageImage);
    const index = images.indexOf(current);
    if (index >= 0) return images.slice(index + 1, index + 1 + count);
  }
  return [];
};

const readPageImage = async (
  image: HTMLImageElement,
  signal?: AbortSignal,
): Promise<{
  src: string;
  bytes: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
}> => {
  const src = image.currentSrc || image.src;
  if (!src) throw new Error('manga: 页面图片地址无效');
  const response = await fetch(src, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`manga: 图片读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const bytes = await blob.arrayBuffer();
  const rect = image.getBoundingClientRect();
  return {
    src,
    bytes,
    mimeType: resolveMangaImageMimeType(blob.type, src),
    width: image.naturalWidth || Math.round(rect.width),
    height: image.naturalHeight || Math.round(rect.height),
  };
};

const errorDetail = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback;
  const detail = error.message.replace(/^manga:\s*/, '');
  return detail || fallback;
};

export interface UseMangaTranslationResult {
  /** The current page has an image large enough to translate. */
  available: boolean;
  loading: boolean;
  /** An overlay is displayed (possibly with zero bubbles); false when off. */
  translated: boolean;
  /** Current display mode; `off` keeps `result` so it can be shown again. */
  mode: MangaTranslationMode;
  /** Extra fields for rendering; `MangaOverlay` is mounted from these. */
  imageEl: HTMLImageElement | null;
  result: MangaPageResult | null;
  /**
   * Legacy two-state toggle: off → bubble, any mode → off. Unlike cycleMode,
   * it clears the result, matching the pre-danmaku behaviour.
   */
  toggle: () => Promise<void>;
  /** off → bubble (translating once) → danmaku → off. */
  cycleMode: () => Promise<void>;
}

export function useMangaTranslation(
  bookKey: string,
  view: FoliateView | null,
): UseMangaTranslationResult {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const pageLocation = useBookProgress(bookKey)?.location ?? null;
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<MangaPageResult | null>(null);
  const [mode, setModeState] = useState<MangaTranslationMode>('off');

  // Async work reads the mode through a ref: a page effect must not be torn
  // down and re-run every time the overlay mode changes.
  const modeRef = useRef<MangaTranslationMode>('off');
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  // Page results the service already produced in this book session. The
  // service has its own persistent cache; this only saves re-reading the image
  // bytes when the reader toggles the overlay off and on again.
  const cacheRef = useRef(new Map<string, MangaPageResult>());

  const applyMode = useCallback((next: MangaTranslationMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  const updateLoading = useCallback((next: boolean) => {
    loadingRef.current = next;
    setLoading(next);
  }, []);

  const persistMode = useCallback(
    (next: MangaTranslationMode) => {
      // Per book, like other reading-mode flags; no restyling is needed.
      void saveViewSettings(envConfig, bookKey, 'mangaTranslationMode', next, true, false);
    },
    [envConfig, bookKey],
  );

  useEffect(() => {
    cacheRef.current.clear();
  }, [bookKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;
    },
    [],
  );

  /** One background page. Never touches UI state and never toasts. */
  const prefetchPage = useCallback(
    async (image: HTMLImageElement, signal: AbortSignal) => {
      try {
        const endpoint = getMangaEndpoint();
        if (!endpoint) return;
        const src = image.currentSrc || image.src;
        if (!src || cacheRef.current.has(src)) return;

        const prepared = await readPageImage(image, signal);
        if (signal.aborted) return;

        const glossary = getGlossary();
        const targetLang = normalizeMangaTargetLang(
          useReaderStore.getState().getViewSettings(bookKey)?.translateTargetLang,
        );
        const cacheKey = makeMangaCacheKey(
          hashBytes(new Uint8Array(prepared.bytes)),
          endpoint.model,
          targetLang,
          glossaryRevision(glossary),
        );
        const cached = await getMangaPage(cacheKey);
        if (signal.aborted) return;
        if (cached) {
          cacheRef.current.set(prepared.src, cached);
          return;
        }

        const page = await translateMangaPage({
          image: prepared.bytes,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          endpoint,
          glossary,
          targetLang,
          signal,
        });
        if (signal.aborted) return;
        cacheRef.current.set(prepared.src, page);
      } catch {
        // Prefetch is opportunistic: a failure leaves the page untouched and
        // the reader translates it on demand. Nothing is shown for it.
      }
    },
    [bookKey],
  );

  /** Translate the pages after the current one, at idle priority. */
  const schedulePrefetch = useCallback(
    (currentImage: HTMLImageElement) => {
      if (modeRef.current === 'off') return;
      const following = pickFollowingPageImages(view, currentImage, MANGA_PREFETCH_PAGES);
      if (following.length === 0) return;

      prefetchAbortRef.current?.abort();
      const controller = new AbortController();
      prefetchAbortRef.current = controller;

      const run = async () => {
        for (const image of following) {
          if (controller.signal.aborted) return;
          await prefetchPage(image, controller.signal);
        }
      };

      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(() => void run(), { timeout: 2000 });
      } else {
        setTimeout(() => void run(), 0);
      }
    },
    [prefetchPage, view],
  );

  /**
   * Translate `image` and show it in `desiredMode`. The persistent cache is
   * checked before the loading state is entered, so a page seen before renders
   * immediately and without a spinner.
   */
  const translatePage = useCallback(
    async (
      image: HTMLImageElement,
      desiredMode: MangaTranslationMode,
      options: { persist?: boolean } = {},
    ) => {
      if (loadingRef.current) return;
      const src = image.currentSrc || image.src;

      const endpoint = getMangaEndpoint();
      if (!endpoint) {
        void eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('未配置视觉模型端点'),
        });
        return;
      }

      const inMemory = src ? cacheRef.current.get(src) : undefined;
      if (inMemory) {
        setImageEl(image);
        setResult(inMemory);
        applyMode(desiredMode);
        if (options.persist) persistMode(desiredMode);
        schedulePrefetch(image);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const prepared = await readPageImage(image, controller.signal);
        if (controller.signal.aborted) return;

        const glossary = getGlossary();
        const targetLang = normalizeMangaTargetLang(
          useReaderStore.getState().getViewSettings(bookKey)?.translateTargetLang,
        );
        const cacheKey = makeMangaCacheKey(
          hashBytes(new Uint8Array(prepared.bytes)),
          endpoint.model,
          targetLang,
          glossaryRevision(glossary),
        );
        const cached = await getMangaPage(cacheKey);
        if (controller.signal.aborted) return;
        if (cached) {
          cacheRef.current.set(prepared.src, cached);
          setImageEl(image);
          setResult(cached);
          applyMode(desiredMode);
          if (options.persist) persistMode(desiredMode);
          schedulePrefetch(image);
          return;
        }

        updateLoading(true);
        void eventDispatcher.dispatch('toast', { type: 'info', message: _('漫画翻译中…') });

        const page = await translateMangaPage({
          image: prepared.bytes,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          endpoint,
          glossary,
          targetLang,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        cacheRef.current.set(prepared.src, page);
        setImageEl(image);
        setResult(page);
        applyMode(desiredMode);
        if (options.persist) persistMode(desiredMode);

        if (page.bubbles.length > 0) {
          void eventDispatcher.dispatch('toast', {
            type: 'success',
            message: _('已翻译 {{count}} 处', { count: page.bubbles.length }),
          });
        } else {
          void eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('本页没有识别到文字'),
          });
        }
        schedulePrefetch(image);
      } catch (error) {
        if (controller.signal.aborted) return;
        void eventDispatcher.dispatch('toast', {
          type: 'error',
          message: errorDetail(error, _('漫画翻译失败')),
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          updateLoading(false);
        }
      }
    },
    [_, applyMode, bookKey, persistMode, schedulePrefetch, updateLoading],
  );

  // The page effect starts the automatic translation; keeping it behind a ref
  // means a new callback identity never re-triggers a page load.
  const translatePageRef = useRef(translatePage);
  useEffect(() => {
    translatePageRef.current = translatePage;
  }, [translatePage]);

  // A page change drops the old overlay. When the book was opened in a
  // non-off mode, the current page translates automatically — from cache when
  // possible — and never starts more than one request.
  //
  // The image only reaches its final size after the section lays out, so a
  // single check on mount misses it and the toolbar button never appears.
  // Re-check a few times, and again whenever the section finishes loading.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    updateLoading(false);
    setResult(null);

    const restoredMode =
      useReaderStore.getState().getViewSettings(bookKey)?.mangaTranslationMode ?? 'off';
    applyMode(restoredMode);

    let disposed = false;
    let autoStarted = false;

    const refresh = () => {
      const image = pickPageImage(view);
      if (disposed) return false;
      setImageEl(image);
      setAvailable(Boolean(image));
      if (image && !autoStarted && modeRef.current !== 'off') {
        autoStarted = true;
        void translatePageRef.current(image, modeRef.current);
      }
      return Boolean(image);
    };

    refresh();

    const timers = [200, 600, 1200, 2400].map((delay) =>
      setTimeout(() => {
        if (refresh()) timers.forEach((timer) => clearTimeout(timer));
      }, delay),
    );

    const viewAny = view as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    } | null;
    const onLoad = () => refresh();
    // `view` is null before the reader mounts; the optional call on the method
    // does not guard the object itself.
    viewAny?.addEventListener?.('load', onLoad);

    return () => {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      viewAny?.removeEventListener?.('load', onLoad);
    };
  }, [applyMode, bookKey, pageLocation, updateLoading, view]);

  /** Translate the current page (once) and show the bubble overlay. */
  const showTranslation = useCallback(async () => {
    if (loadingRef.current) return;

    const image = pickPageImage(view);
    if (!image) {
      void eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('本页没有可翻译的图片'),
      });
      return;
    }

    await translatePage(image, 'bubble', { persist: true });
  }, [_, translatePage, view]);

  const toggle = useCallback(async () => {
    if (loadingRef.current) return;
    if (modeRef.current !== 'off') {
      abortRef.current?.abort();
      abortRef.current = null;
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;
      applyMode('off');
      setResult(null);
      persistMode('off');
      return;
    }
    await showTranslation();
  }, [applyMode, persistMode, showTranslation]);

  const cycleMode = useCallback(async () => {
    if (loadingRef.current) return;
    if (modeRef.current === 'off') {
      await showTranslation();
      return;
    }
    const next: MangaTranslationMode = modeRef.current === 'bubble' ? 'danmaku' : 'off';
    if (next === 'off') {
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;
    }
    applyMode(next);
    persistMode(next);
  }, [applyMode, persistMode, showTranslation]);

  return {
    available,
    loading,
    translated: mode !== 'off',
    mode,
    imageEl,
    result,
    toggle,
    cycleMode,
  };
}

export default useMangaTranslation;
