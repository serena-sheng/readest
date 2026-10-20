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
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import type { MangaTranslationMode } from '@/types/book';
import { computeMangaGutterWidth } from '../components/manga/MangaOverlay';

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

/** One side gutter must fit about six CJK characters on a line. */
export const MANGA_DANMAKU_MIN_GUTTER_WIDTH = 88;
/** Below this the page is no longer readable, whatever the gutter says. */
export const MANGA_DANMAKU_MIN_IMAGE_WIDTH = 160;
/** The page must keep at least this share of the reading area's width. */
export const MANGA_DANMAKU_MIN_IMAGE_RATIO = 0.55;
/** Taller than this is a long-strip page; side gutters become empty columns. */
export const MANGA_DANMAKU_MAX_ASPECT_RATIO = 2;

export const MANGA_NARROW_NOTICE = '窗口太窄，已改用「盖在原文上」';

export type MangaDanmakuBlockedReason = 'narrow' | 'tall';

/** Inline feedback shown in the reading area; never a global toast. */
export type MangaTranslationStatus =
  | { kind: 'translating'; startedAt: number }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export interface MangaDanmakuFitInput {
  imageWidth: number;
  imageHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  contentWidth: number;
}

/**
 * Whether the side-column layout can hold this page. Measured on the reading
 * area (the image's container), never on the whole viewport.
 */
export const computeMangaDanmakuFit = ({
  imageWidth,
  imageHeight,
  naturalWidth,
  naturalHeight,
  contentWidth,
}: MangaDanmakuFitInput): MangaDanmakuBlockedReason | null => {
  const width = imageWidth > 0 ? imageWidth : naturalWidth;
  const height = imageHeight > 0 ? imageHeight : naturalHeight;
  if (width > 0 && height / width > MANGA_DANMAKU_MAX_ASPECT_RATIO) return 'tall';

  const areaWidth = contentWidth > 0 ? contentWidth : width;
  if (!(areaWidth > 0)) return null;

  const gutter = computeMangaGutterWidth(areaWidth);
  if (gutter < MANGA_DANMAKU_MIN_GUTTER_WIDTH) return 'narrow';

  const pageWidth = Math.min(width || areaWidth, areaWidth - gutter * 2);
  if (pageWidth < Math.max(MANGA_DANMAKU_MIN_IMAGE_WIDTH, areaWidth * MANGA_DANMAKU_MIN_IMAGE_RATIO)) {
    return 'narrow';
  }
  return null;
};

/**
 * Map service and transport failures to a sentence a reader can act on. The
 * server's own text is never shown: it leaks provider names and HTTP jargon.
 */
export const mangaErrorReason = (error: unknown, fallback = '出了点问题，再试一次。'): string => {
  const message = error instanceof Error ? error.message : '';
  if (/HTTP 401|HTTP 403/.test(message)) return '模型拒绝了 API Key，去设置里换一个新的。';
  if (/HTTP 429/.test(message)) return '请求太频繁，等一下再试。';
  if (/超时|timeout|timed out/i.test(message)) return '模型很久没有返回结果。';
  if (/HTTP 413|too large|过大/i.test(message)) return '这一页对模型来说太大了。';
  if (/响应为空|HTTP 5\d\d/.test(message)) return '出了点问题，再试一次。';
  if (/图片读取失败|网络|fetch|不可用|Failed to fetch/i.test(message)) {
    return '网络好像断了，检查后再试。';
  }
  return fallback;
};

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
  /** Inline progress / empty / error feedback for the reading area. */
  status: MangaTranslationStatus | null;
  /** Session-only "fit page" zoom for the side-column layout. */
  fitPage: () => void;

  /** Why the side-column mode is unavailable on this page; null when it fits. */
  danmakuDisabledReason: MangaDanmakuBlockedReason | null;
  /** True when the vision endpoint is missing; the toolbar shows the setup guide. */
  needsModelSetup: boolean;
  /**
   * Main-button toggle: off → the last non-off mode (bubble when none),
   * on → off. During a request it cancels instead.
   */
  toggle: () => Promise<void>;
  /** off → bubble (translating once) → danmaku → off. */
  cycleMode: () => Promise<void>;
  /** Choose one mode directly; `danmaku` degrades to `bubble` when it can't fit. */
  setMode: (mode: MangaTranslationMode) => Promise<void>;
  /** Cancel the in-flight page request and clear its status. */
  stop: () => void;
  /** Re-run the last page request after a failure. */
  retry: () => Promise<void>;
  /** Clear the inline status (used by the empty notice's own timer). */
  dismissStatus: () => void;
  /** Dismiss the missing-model guide without changing any mode. */
  dismissModelSetup: () => void;
}

export interface UseMangaTranslationOptions {
  /** Called once per opened book when a too-narrow window forces bubble mode. */
  onNarrowFallback?: (message: string) => void;
}

export function useMangaTranslation(
  bookKey: string,
  view: FoliateView | null,
  options: UseMangaTranslationOptions = {},
): UseMangaTranslationResult {
  const { envConfig } = useEnv();
  const pageLocation = useBookProgress(bookKey)?.location ?? null;
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<MangaPageResult | null>(null);
  const [mode, setModeState] = useState<MangaTranslationMode>('off');
  const [status, setStatus] = useState<MangaTranslationStatus | null>(null);
  const [danmakuDisabledReason, setDanmakuDisabledReason] =
    useState<MangaDanmakuBlockedReason | null>(null);
  const [needsModelSetup, setNeedsModelSetup] = useState(false);

  // Async work reads the mode through a ref: a page effect must not be torn
  // down and re-run every time the overlay mode changes.
  const modeRef = useRef<MangaTranslationMode>('off');
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  // The mode to restore when the main button opens the overlay: turning off
  // must not forget whether the reader preferred bubble or side columns.
  const lastModeRef = useRef<MangaTranslationMode>('bubble');
  const narrowNoticeShownRef = useRef(false);
  const fitReasonRef = useRef<MangaDanmakuBlockedReason | null>(null);
  const lastRequestRef = useRef<{
    image: HTMLImageElement;
    mode: MangaTranslationMode;
    persist: boolean;
  } | null>(null);
  const onNarrowFallbackRef = useRef(options.onNarrowFallback);
  onNarrowFallbackRef.current = options.onNarrowFallback;

  // Page results the service already produced in this book session. The
  // service has its own persistent cache; this only saves re-reading the image
  // bytes when the reader toggles the overlay off and on again.
  const cacheRef = useRef(new Map<string, MangaPageResult>());

  const applyMode = useCallback((next: MangaTranslationMode) => {
    if (next !== 'off') lastModeRef.current = next;
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

  // The page effect must run on page changes only; persisting goes through a
  // ref so a fresh `envConfig` object can't re-create the effect's callbacks.
  const persistModeRef = useRef(persistMode);
  persistModeRef.current = persistMode;

  /** Measure this page against the reading area and remember the verdict. */
  const refreshDanmakuFit = useCallback((image: HTMLImageElement) => {
    const rect = image.getBoundingClientRect();
    const parent = image.parentElement;
    const parentWidth = parent?.clientWidth ?? 0;
    const contentWidth =
      parentWidth > 0 ? parentWidth : parent?.getBoundingClientRect().width || rect.width;
    const reason = computeMangaDanmakuFit({
      imageWidth: rect.width,
      imageHeight: rect.height,
      naturalWidth: image.naturalWidth || 0,
      naturalHeight: image.naturalHeight || 0,
      contentWidth,
    });
    fitReasonRef.current = reason;
    setDanmakuDisabledReason(reason);
    return reason;
  }, []);

  /**
   * Side columns don't fit: show bubbles instead, write the preference so a
   * later page doesn't silently flip back, and tell the reader once per book.
   */
  const fallBackToBubble = useCallback(
    (reason: MangaDanmakuBlockedReason) => {
      applyMode('bubble');
      persistModeRef.current('bubble');
      if (reason === 'narrow' && !narrowNoticeShownRef.current) {
        narrowNoticeShownRef.current = true;
        onNarrowFallbackRef.current?.(MANGA_NARROW_NOTICE);
      }
    },
    [applyMode],
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
      requestOptions: { persist?: boolean } = {},
    ) => {
      if (loadingRef.current) return;

      const fit = refreshDanmakuFit(image);
      if (desiredMode === 'danmaku' && fit) {
        fallBackToBubble(fit);
        desiredMode = 'bubble';
      }
      lastRequestRef.current = {
        image,
        mode: desiredMode,
        persist: requestOptions.persist ?? false,
      };

      const src = image.currentSrc || image.src;

      const endpoint = getMangaEndpoint();
      if (!endpoint) {
        setNeedsModelSetup(true);
        return;
      }

      const inMemory = src ? cacheRef.current.get(src) : undefined;
      if (inMemory) {
        setStatus(null);
        setImageEl(image);
        setResult(inMemory);
        applyMode(desiredMode);
        if (requestOptions.persist) persistMode(desiredMode);
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
          setStatus(null);
          setImageEl(image);
          setResult(cached);
          applyMode(desiredMode);
          if (requestOptions.persist) persistMode(desiredMode);
          schedulePrefetch(image);
          return;
        }

        updateLoading(true);
        setStatus({ kind: 'translating', startedAt: Date.now() });

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
        if (requestOptions.persist) persistMode(desiredMode);

        // A successful page is its own feedback. An empty result is not: it
        // leaves the artwork unchanged, so say so inline for a moment.
        setStatus(page.bubbles.length > 0 ? null : { kind: 'empty' });
        schedulePrefetch(image);
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus({ kind: 'error', message: mangaErrorReason(error) });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          updateLoading(false);
        }
      }
    },
    [
      applyMode,
      bookKey,
      fallBackToBubble,
      persistMode,
      refreshDanmakuFit,
      schedulePrefetch,
      updateLoading,
    ],
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
    setStatus(null);

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
      if (!image) {
        setDanmakuDisabledReason(null);
        return false;
      }

      const fit = refreshDanmakuFit(image);
      // A restored side-column preference must not outlive the window that
      // could hold it: degrade before the automatic translation starts.
      if (modeRef.current === 'danmaku' && fit) {
        fallBackToBubble(fit);
      }
      if (!autoStarted && modeRef.current !== 'off') {
        autoStarted = true;
        void translatePageRef.current(image, modeRef.current);
      }
      return true;
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
  }, [applyMode, bookKey, fallBackToBubble, pageLocation, refreshDanmakuFit, updateLoading, view]);

  // A window resize can take the side columns away (or give them back). Only
  // the removal is acted on: widening never silently flips a reader back.
  useEffect(() => {
    const handleResize = () => {
      const image = pickPageImage(view);
      if (!image) return;
      const fit = refreshDanmakuFit(image);
      if (modeRef.current === 'danmaku' && fit) fallBackToBubble(fit);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fallBackToBubble, refreshDanmakuFit, view]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    updateLoading(false);
    setStatus(null);
  }, [updateLoading]);

  const turnOff = useCallback(() => {
    stop();
    applyMode('off');
    // The result stays: re-opening the overlay reuses it without a request.
    persistMode('off');
  }, [applyMode, persistMode, stop]);

  const dismissStatus = useCallback(() => setStatus(null), []);
  const dismissModelSetup = useCallback(() => setNeedsModelSetup(false), []);

  /**
   * Show `next` for the current page. `off` clears the overlay; other modes
   * reuse the session cache when possible and otherwise translate once.
   */
  const setMode = useCallback(
    async (next: MangaTranslationMode) => {
      if (next === 'off') {
        turnOff();
        return;
      }
      if (loadingRef.current) return;

      const image = pickPageImage(view);
      if (!image) {
        setStatus({ kind: 'error', message: '本页没有可翻译的图片' });
        return;
      }
      await translatePage(image, next, { persist: true });
    },
    [translatePage, turnOff, view],
  );

  const toggle = useCallback(async () => {
    if (loadingRef.current) {
      stop();
      return;
    }
    if (modeRef.current !== 'off') {
      turnOff();
      return;
    }
    await setMode(lastModeRef.current);
  }, [setMode, stop, turnOff]);

  const cycleMode = useCallback(async () => {
    if (loadingRef.current) return;
    if (modeRef.current === 'off') {
      await setMode('bubble');
      return;
    }
    if (modeRef.current === 'bubble') {
      await setMode('danmaku');
      return;
    }
    turnOff();
  }, [setMode, turnOff]);

  const retry = useCallback(async () => {
    const last = lastRequestRef.current;
    setStatus(null);
    if (!last) return;
    await translatePage(last.image, last.mode, { persist: last.persist });
  }, [translatePage]);

  // Shift+I is resolved by useBookShortcuts and scoped to the active book.
  useEffect(() => {
    const handleToggle = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string } | undefined;
      if (detail?.bookKey !== bookKey) return false;
      void toggle();
      return true;
    };
    eventDispatcher.onSync('toggle-manga-translation', handleToggle);
    return () => eventDispatcher.offSync('toggle-manga-translation', handleToggle);
  }, [bookKey, toggle]);

  /**
   * Session-only zoom for the side-column layout: the page often renders at
   * 100% and leaves the columns sitting in dead space. Deliberately not written
   * back to view settings — the reader's own zoom choice survives.
   */
  const fitPage = useCallback(() => {
    const renderer = (view as unknown as { renderer?: { setAttribute?: (k: string, v: string) => void } })
      ?.renderer;
    renderer?.setAttribute?.('zoom', 'fit-page');
  }, [view]);

  return {
    available,
    loading,
    fitPage,
    translated: mode !== 'off',
    mode,
    imageEl,
    result,
    status,
    danmakuDisabledReason,
    needsModelSetup,
    toggle,
    cycleMode,
    setMode,
    stop,
    retry,
    dismissStatus,
    dismissModelSetup,
  };
}

export default useMangaTranslation;
