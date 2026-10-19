'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import { translateMangaPage } from '@/services/manga/translateMangaPage';
import { getMangaEndpoint } from '@/services/translators/endpoints';
import { getGlossary } from '@/services/translators/glossary';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';

/** A page image smaller than this on its short rendered side is a thumbnail,
 *  not a manga page, and is not offered for translation. */
export const MIN_MANGA_IMAGE_SHORT_SIDE = 300;

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

export type MangaTranslationMode = 'off' | 'bubble' | 'danmaku';

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
  const pageLocation = useBookProgress(bookKey)?.location ?? null;
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<MangaPageResult | null>(null);
  const [mode, setMode] = useState<MangaTranslationMode>('off');
  const abortRef = useRef<AbortController | null>(null);
  // Page results the service already produced in this book session. The
  // service has its own persistent cache; this only saves re-reading the image
  // bytes when the reader toggles the overlay off and on again.
  const cacheRef = useRef(new Map<string, MangaPageResult>());

  useEffect(() => {
    cacheRef.current.clear();
  }, [bookKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  // A page change removes the old overlay and never starts a new translation.
  //
  // The image only reaches its final size after the section lays out, so a
  // single check on mount misses it and the toolbar button never appears.
  // Re-check a few times, and again whenever the section finishes loading.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setResult(null);
    setMode('off');

    const refresh = () => {
      const image = pickPageImage(view);
      setImageEl(image);
      setAvailable(Boolean(image));
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
      timers.forEach((timer) => clearTimeout(timer));
      viewAny?.removeEventListener?.('load', onLoad);
    };
  }, [bookKey, view, pageLocation]);

  /** Translate the current page (once) and show the bubble overlay. */
  const showTranslation = useCallback(async () => {
    if (loading) return;

    const image = pickPageImage(view);
    if (!image) {
      void eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('本页没有可翻译的图片'),
      });
      return;
    }

    // Turning the overlay back on reuses the page result already in memory;
    // `mode === 'off'` keeps it instead of clearing it.
    if (result) {
      setImageEl(image);
      setMode('bubble');
      return;
    }

    const endpoint = getMangaEndpoint();
    if (!endpoint) {
      void eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('未配置视觉模型端点'),
      });
      return;
    }

    const src = image.currentSrc || image.src;
    const cached = src ? cacheRef.current.get(src) : undefined;
    if (cached) {
      setImageEl(image);
      setResult(cached);
      setMode('bubble');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    void eventDispatcher.dispatch('toast', { type: 'info', message: _('漫画翻译中…') });

    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const rect = image.getBoundingClientRect();
      const page = await translateMangaPage({
        image: await blob.arrayBuffer(),
        mimeType: resolveMangaImageMimeType(blob.type, src),
        width: image.naturalWidth || Math.round(rect.width),
        height: image.naturalHeight || Math.round(rect.height),
        endpoint,
        glossary: getGlossary(),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      if (src) cacheRef.current.set(src, page);
      setImageEl(image);
      setResult(page);
      setMode('bubble');
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
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail =
        error instanceof Error ? error.message.replace(/^manga:\s*/, '') : _('漫画翻译失败');
      void eventDispatcher.dispatch('toast', { type: 'error', message: detail });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [_, loading, result, view]);

  const toggle = useCallback(async () => {
    if (loading) return;
    if (mode !== 'off') {
      setMode('off');
      setResult(null);
      return;
    }
    await showTranslation();
  }, [loading, mode, showTranslation]);

  const cycleMode = useCallback(async () => {
    if (loading) return;
    if (mode === 'off') {
      await showTranslation();
      return;
    }
    setMode(mode === 'bubble' ? 'danmaku' : 'off');
  }, [loading, mode, showTranslation]);

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
