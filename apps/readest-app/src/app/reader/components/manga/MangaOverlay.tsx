'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { MangaPageResult } from '@/services/manga/types';
import { useThemeStore } from '@/store/themeStore';

export const MANGA_LAYER_CLASS = 'manga-translation-layer';
const BUBBLE_CLASS = 'manga-bubble-text';
const BUBBLE_PADDING = 2;
const MIN_FONT_SIZE = 9;
const LINE_HEIGHT = 1.15;

export interface MangaOverlayProps {
  /** The page image the bubbles belong to. Its parent is the anchor. */
  imageEl: HTMLImageElement;
  result: MangaPageResult;
}

interface OverlayFrame {
  /** Image's top-left inside the parent's padding box, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** Rendered image size, the denominator of the natural-pixel scale. */
  width: number;
  height: number;
}

/**
 * Largest font size that keeps `text` inside a `width × height` box.
 *
 * Starts from the box's short side and shrinks one pixel at a time until the
 * estimated line count fits. Japanese/Chinese characters are close to one em
 * wide, so `floor(extent / size)` characters per line is a good estimate; the
 * 1.15 line height is the same value the bubble renders with.
 */
export const computeMangaBubbleFontSize = ({
  width,
  height,
  text,
  vertical,
}: {
  width: number;
  height: number;
  text: string;
  vertical: boolean;
}): number => {
  const innerWidth = Math.max(1, width - BUBBLE_PADDING * 2);
  const innerHeight = Math.max(1, height - BUBBLE_PADDING * 2);
  if (innerWidth <= 1 || innerHeight <= 1) return MIN_FONT_SIZE;

  const chars = Math.max(1, Array.from(text).length);
  // Start at the short side; the fit loop below shrinks from there.
  let size = Math.floor(Math.min(innerWidth, innerHeight));
  const lineExtent = vertical ? innerHeight : innerWidth;
  const crossExtent = vertical ? innerWidth : innerHeight;

  while (size > MIN_FONT_SIZE) {
    const charsPerLine = Math.max(1, Math.floor(lineExtent / size));
    const lines = Math.ceil(chars / charsPerLine);
    if (lines * size * LINE_HEIGHT <= crossExtent) break;
    size -= 1;
  }
  return Math.max(MIN_FONT_SIZE, size);
};

const MangaOverlay: React.FC<MangaOverlayProps> = ({ imageEl, result }) => {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [layerEl, setLayerEl] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<OverlayFrame | null>(null);
  const bubbleCount = result.bubbles.length;

  // The overlay lives in the image's own document (the reader iframe), so it
  // is built imperatively there. React only owns the bubble contents through
  // the portal below.
  useEffect(() => {
    if (bubbleCount === 0) return;
    const parent = imageEl.parentElement;
    if (!parent) return;

    const doc = imageEl.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = MANGA_LAYER_CLASS;
    layer.dataset['mms'] = '1';
    layer.style.position = 'absolute';
    layer.style.top = '0';
    layer.style.right = '0';
    layer.style.bottom = '0';
    layer.style.left = '0';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = '2';
    layer.style.overflow = 'hidden';

    // `inset: 0` resolves against the nearest positioned ancestor; make the
    // image's own parent that ancestor so the layer tracks the page image.
    const previousPosition = parent.style.position;
    const computedPosition =
      typeof doc.defaultView?.getComputedStyle === 'function'
        ? doc.defaultView.getComputedStyle(parent).position
        : '';
    if (!computedPosition || computedPosition === 'static') {
      parent.style.position = 'relative';
    }

    parent.appendChild(layer);

    const measure = () => {
      const parentRect = parent.getBoundingClientRect();
      const imageRect = imageEl.getBoundingClientRect();
      const next: OverlayFrame = {
        offsetX: imageRect.left - parentRect.left - parent.clientLeft,
        offsetY: imageRect.top - parentRect.top - parent.clientTop,
        width: imageRect.width,
        height: imageRect.height,
      };
      setFrame((current) =>
        current !== null &&
        Math.abs(current.offsetX - next.offsetX) < 0.5 &&
        Math.abs(current.offsetY - next.offsetY) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next,
      );
    };

    measure();

    const view = doc.defaultView;
    let observer: ResizeObserver | null = null;
    if (typeof view?.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(measure);
      observer.observe(imageEl);
      observer.observe(parent);
    }
    view?.addEventListener('resize', measure);

    setLayerEl(layer);
    return () => {
      observer?.disconnect();
      view?.removeEventListener('resize', measure);
      layer.remove();
      parent.style.position = previousPosition;
      setLayerEl(null);
      setFrame(null);
    };
  }, [imageEl, bubbleCount]);

  if (bubbleCount === 0 || !layerEl) return null;

  const naturalWidth = imageEl.naturalWidth || result.width;
  const naturalHeight = imageEl.naturalHeight || result.height;
  const scaleX = frame && naturalWidth > 0 ? frame.width / naturalWidth : 0;
  const scaleY = frame && naturalHeight > 0 ? frame.height / naturalHeight : 0;

  return createPortal(
    <>
      {result.bubbles.map((bubble, index) => {
        const [x1, y1, x2, y2] = bubble.box;
        const left = (frame?.offsetX ?? 0) + x1 * scaleX;
        const top = (frame?.offsetY ?? 0) + y1 * scaleY;
        const width = Math.max(1, (x2 - x1) * scaleX);
        const height = Math.max(1, (y2 - y1) * scaleY);
        const fontSize = computeMangaBubbleFontSize({
          width,
          height,
          text: bubble.dst,
          vertical: bubble.vertical,
        });

        return (
          <div
            key={`${index}-${x1}-${y1}`}
            className={BUBBLE_CLASS}
            title={bubble.src}
            style={{
              position: 'absolute',
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              padding: `${BUBBLE_PADDING}px`,
              background: isDarkMode ? 'rgba(17, 17, 17, 0.92)' : 'rgba(255, 255, 255, 0.92)',
              color: isDarkMode ? '#f5f5f5' : '#111111',
              borderRadius: '3px',
              fontSize: `${fontSize}px`,
              lineHeight: LINE_HEIGHT,
              overflow: 'hidden',
              wordBreak: 'break-word',
              textAlign: 'center',
              ...(bubble.vertical
                ? { writingMode: 'vertical-rl' as const, textOrientation: 'upright' as const }
                : {}),
            }}
          >
            {bubble.dst}
          </div>
        );
      })}
    </>,
    layerEl,
  );
};

export default MangaOverlay;
