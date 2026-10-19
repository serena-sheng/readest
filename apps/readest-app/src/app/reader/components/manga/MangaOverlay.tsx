'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { MangaPageResult } from '@/services/manga/types';
import { useThemeStore } from '@/store/themeStore';

export const MANGA_LAYER_CLASS = 'manga-translation-layer';
export const MANGA_GUTTER_CLASS = 'manga-danmaku-gutter';
export const MANGA_CHIP_CLASS = 'manga-danmaku-chip';
export const MANGA_SCROLL_HINT_CLASS = 'manga-danmaku-scroll-hint';
const BUBBLE_CLASS = 'manga-bubble-text';
const BUBBLE_PADDING = 2;
const MIN_FONT_SIZE = 9;
const LINE_HEIGHT = 1.15;

// Danmaku gutters: the gutter takes a fifth of the container, bounded by these
// limits, and the page image must keep at least MIN_DANMAKU_IMAGE_WIDTH.
const GUTTER_RATIO = 0.2;
const GUTTER_MIN_WIDTH = 150;
const GUTTER_MAX_WIDTH = 300;
const MIN_DANMAKU_IMAGE_WIDTH = 120;
const DANMAKU_FONT_SIZE = 14;
const DANMAKU_LINE_HEIGHT = 1.35;
const DANMAKU_GAP = 6;
const CHIP_PADDING_X = 6;
const CHIP_PADDING_Y = 3;
const CHIP_BORDER_LEFT = 3;
const SCROLL_HINT_HEIGHT = 22;
const SCROLL_HINT_THRESHOLD = 6;

export type MangaOverlayMode = 'bubble' | 'danmaku';

export interface MangaOverlayProps {
  /** The page image the bubbles belong to. Its parent is the anchor. */
  imageEl: HTMLImageElement;
  result: MangaPageResult;
  /** `bubble` paints inside the image (default); `danmaku` uses side gutters. */
  mode?: MangaOverlayMode;
}

type DanmakuSide = 'left' | 'right';

/**
 * Width of one side gutter for a container of `parentWidth`:
 * `clamp(parentWidth * 0.2, 150, 300)`, then narrowed so the image keeps
 * MIN_DANMAKU_IMAGE_WIDTH, and never below a quarter-width floor on very
 * narrow containers. This is the reference implementation's formula.
 */
export const computeMangaGutterWidth = (parentWidth: number): number => {
  if (!Number.isFinite(parentWidth) || parentWidth <= 0) return 0;

  const naturalGutter = Math.min(
    Math.max(Math.round(parentWidth * GUTTER_RATIO), GUTTER_MIN_WIDTH),
    GUTTER_MAX_WIDTH,
  );
  const maxGutterByFit = Math.max(0, Math.floor((parentWidth - MIN_DANMAKU_IMAGE_WIDTH) / 2));
  return Math.max(
    Math.min(naturalGutter, maxGutterByFit),
    Math.min(GUTTER_MIN_WIDTH, Math.floor(parentWidth / 4)),
  );
};

/**
 * Height estimate for a chip whose layout cannot be measured (jsdom, or before
 * the first paint). Chips have a fixed font size and line height, so counting
 * wrapped lines is enough.
 */
export const estimateMangaDanmakuChipHeight = (text: string, gutterWidth: number): number => {
  const innerWidth = Math.max(1, gutterWidth - CHIP_PADDING_X * 2 - CHIP_BORDER_LEFT);
  const charsPerLine = Math.max(1, Math.floor(innerWidth / DANMAKU_FONT_SIZE));
  const lines = Math.max(1, Math.ceil(Array.from(text).length / charsPerLine));
  return lines * DANMAKU_FONT_SIZE * DANMAKU_LINE_HEIGHT + CHIP_PADDING_Y * 2;
};

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

const MangaOverlay: React.FC<MangaOverlayProps> = ({ imageEl, result, mode = 'bubble' }) => {
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

  // Danmaku mode: narrow the page image and stack the translations in two
  // gutters pinned to the container's left and right edges. Everything here is
  // imperative because the chips have to be measured and packed after layout;
  // React only owns the bubble layer above.
  useEffect(() => {
    if (mode !== 'danmaku' || bubbleCount === 0 || !layerEl) return;
    const parent = imageEl.parentElement;
    if (!parent) return;

    const doc = imageEl.ownerDocument;
    const view = doc.defaultView;
    const parentRect = parent.getBoundingClientRect();
    const parentWidth = parent.clientWidth || parentRect.width || 0;
    const gutterWidth = computeMangaGutterWidth(parentWidth);
    if (gutterWidth <= 0) return;

    const naturalWidth = imageEl.naturalWidth || result.width || 1;
    const naturalHeight = imageEl.naturalHeight || result.height || 1;
    const initialWidth = imageEl.getBoundingClientRect().width;
    const availableWidth = Math.max(parentWidth - gutterWidth * 2, MIN_DANMAKU_IMAGE_WIDTH);
    // Only ever narrow, never enlarge: a small image keeps its own width.
    const shouldShrink = initialWidth > 0 && availableWidth < initialWidth;

    const style = imageEl.style;
    const original = {
      width: {
        value: style.getPropertyValue('width'),
        priority: style.getPropertyPriority('width'),
      },
      'max-width': {
        value: style.getPropertyValue('max-width'),
        priority: style.getPropertyPriority('max-width'),
      },
      height: {
        value: style.getPropertyValue('height'),
        priority: style.getPropertyPriority('height'),
      },
      'margin-left': {
        value: style.getPropertyValue('margin-left'),
        priority: style.getPropertyPriority('margin-left'),
      },
      'margin-right': {
        value: style.getPropertyValue('margin-right'),
        priority: style.getPropertyPriority('margin-right'),
      },
    } as const;

    // Restore the exact inline values the page shipped with; the page's own
    // CSS is never touched.
    const restoreImage = () => {
      for (const [property, saved] of Object.entries(original)) {
        if (saved.value) style.setProperty(property, saved.value, saved.priority);
        else style.removeProperty(property);
      }
    };

    const applyNarrow = () => {
      restoreImage();
      if (shouldShrink) {
        style.setProperty('width', `${availableWidth}px`);
        style.setProperty('max-width', 'none');
        style.setProperty('height', 'auto');
      }
      // The gutters sit at the container edges, so the image must reserve a
      // gutter's width on each side even when it was not narrowed.
      style.setProperty('margin-left', `${gutterWidth}px`);
      style.setProperty('margin-right', `${gutterWidth}px`);
    };
    applyNarrow();

    const makeGutter = (side: DanmakuSide): HTMLDivElement => {
      const gutter = doc.createElement('div');
      gutter.className = MANGA_GUTTER_CLASS;
      gutter.dataset['mms'] = '1';
      gutter.dataset['side'] = side;
      gutter.style.position = 'absolute';
      gutter.style.top = '0';
      gutter.style.boxSizing = 'border-box';
      gutter.style.overflowX = 'visible';
      gutter.style.overflowY = 'visible';
      gutter.style.pointerEvents = 'none';
      gutter.style.zIndex = '3';
      gutter.style.width = `${gutterWidth}px`;
      layerEl.appendChild(gutter);
      return gutter;
    };
    const gutters: Record<DanmakuSide, HTMLDivElement> = {
      left: makeGutter('left'),
      right: makeGutter('right'),
    };

    const reducedMotion =
      typeof view?.matchMedia === 'function' &&
      view.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const mid = naturalWidth / 2;
    const items = result.bubbles.map((bubble) => {
      const [x1, y1, x2, y2] = bubble.box;
      const side: DanmakuSide = (x1 + x2) / 2 < mid ? 'left' : 'right';
      const chip = doc.createElement('div');
      chip.className = MANGA_CHIP_CLASS;
      chip.dataset['mms'] = '1';
      chip.dataset['side'] = side;
      chip.textContent = bubble.dst;
      chip.title = bubble.src;
      chip.style.position = 'absolute';
      chip.style.boxSizing = 'border-box';
      chip.style.width = '100%';
      chip.style.fontSize = `${DANMAKU_FONT_SIZE}px`;
      chip.style.lineHeight = `${DANMAKU_LINE_HEIGHT}`;
      // White glass with a magenta spine, legible over any manga artwork.
      chip.style.color = '#3A2230';
      chip.style.background = 'rgba(255, 255, 255, 0.9)';
      chip.style.backdropFilter = 'blur(10px)';
      chip.style.setProperty('-webkit-backdrop-filter', 'blur(10px)');
      chip.style.borderLeft = `${CHIP_BORDER_LEFT}px solid #F0457E`;
      chip.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.18)';
      chip.style.borderRadius = '6px';
      chip.style.padding = `${CHIP_PADDING_Y}px ${CHIP_PADDING_X}px`;
      chip.style.overflowWrap = 'break-word';
      chip.style.whiteSpace = 'pre-wrap';
      chip.style.pointerEvents = 'none';
      gutters[side].appendChild(chip);

      if (!reducedMotion && typeof chip.animate === 'function') {
        const offset = side === 'left' ? -14 : 14;
        chip.animate(
          [
            { opacity: 0, transform: `translateX(${offset}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          { duration: 180, easing: 'ease-out' },
        );
      }
      return { el: chip, side, anchor: (y1 + y2) / 2, text: bubble.dst };
    });

    const makeScrollHint = (side: DanmakuSide, edge: 'top' | 'bottom'): HTMLDivElement => {
      const hint = doc.createElement('div');
      hint.className = MANGA_SCROLL_HINT_CLASS;
      hint.dataset['mms'] = '1';
      hint.dataset['side'] = side;
      hint.dataset['edge'] = edge;
      hint.style.position = 'absolute';
      hint.style.width = `${gutterWidth}px`;
      hint.style.height = `${SCROLL_HINT_HEIGHT}px`;
      hint.style.display = 'none';
      hint.style.pointerEvents = 'none';
      hint.style.zIndex = '4';
      hint.style.background =
        edge === 'top'
          ? 'linear-gradient(rgba(253, 247, 250, 0.92), rgba(253, 247, 250, 0))'
          : 'linear-gradient(rgba(253, 247, 250, 0), rgba(253, 247, 250, 0.92))';
      layerEl.appendChild(hint);
      return hint;
    };
    const hints: Record<DanmakuSide, { top: HTMLDivElement; bottom: HTMLDivElement }> = {
      left: { top: makeScrollHint('left', 'top'), bottom: makeScrollHint('left', 'bottom') },
      right: { top: makeScrollHint('right', 'top'), bottom: makeScrollHint('right', 'bottom') },
    };

    const scrollable: Record<DanmakuSide, boolean> = { left: false, right: false };

    const updateHints = (side: DanmakuSide) => {
      const gutter = gutters[side];
      const canScroll = scrollable[side];
      const showTop = canScroll && gutter.scrollTop > SCROLL_HINT_THRESHOLD;
      const showBottom =
        canScroll &&
        gutter.scrollTop < gutter.scrollHeight - gutter.clientHeight - SCROLL_HINT_THRESHOLD;
      hints[side].top.style.display = showTop ? '' : 'none';
      hints[side].bottom.style.display = showBottom ? '' : 'none';
    };

    const setScrollable = (side: DanmakuSide, on: boolean) => {
      const gutter = gutters[side];
      gutter.style.overflowY = on ? 'auto' : 'visible';
      // Only a scrollable gutter catches wheel/drag events; otherwise the page
      // turn gesture must pass through.
      gutter.style.pointerEvents = on ? 'auto' : 'none';
      gutter.style.overscrollBehavior = on ? 'contain' : '';
      if (on) gutter.style.setProperty('scrollbar-width', 'thin');
      else gutter.style.removeProperty('scrollbar-width');
      updateHints(side);
    };

    const layout = () => {
      const currentParentRect = parent.getBoundingClientRect();
      const imageRect = imageEl.getBoundingClientRect();
      const offsetY = imageRect.top - currentParentRect.top - parent.clientTop;
      const renderedHeight = Math.max(0, imageRect.height);
      const containerWidth = parent.clientWidth || currentParentRect.width || parentWidth;

      gutters.left.style.top = `${offsetY}px`;
      gutters.left.style.height = `${renderedHeight}px`;
      gutters.left.style.left = '0px';
      gutters.right.style.top = `${offsetY}px`;
      gutters.right.style.height = `${renderedHeight}px`;
      gutters.right.style.left = `${Math.max(containerWidth - gutterWidth, 0)}px`;

      (['left', 'right'] as const).forEach((side) => {
        const hintLeft = side === 'left' ? 0 : Math.max(containerWidth - gutterWidth, 0);
        hints[side].top.style.top = `${offsetY}px`;
        hints[side].top.style.left = `${hintLeft}px`;
        hints[side].bottom.style.top = `${offsetY + renderedHeight - SCROLL_HINT_HEIGHT}px`;
        hints[side].bottom.style.left = `${hintLeft}px`;

        const sideItems = items
          .filter((item) => item.side === side)
          .sort((a, b) => a.anchor - b.anchor);

        // Two passes at most: enabling the scrollbar changes the gutter's
        // inner width, which can re-wrap a chip and flip the overflow verdict.
        for (let pass = 0; pass < 2; pass += 1) {
          let bottom = Number.NEGATIVE_INFINITY;
          sideItems.forEach((item) => {
            const chipHeight =
              item.el.offsetHeight || estimateMangaDanmakuChipHeight(item.text, gutterWidth);
            const centered = (item.anchor / naturalHeight) * renderedHeight - chipHeight / 2;
            const top = Math.max(centered, bottom + DANMAKU_GAP);
            item.el.style.top = `${top}px`;
            bottom = top + chipHeight;
          });
          // 1px tolerance: sub-pixel rounding must not flip the state forever.
          const overflowing = bottom > renderedHeight + 1;
          if (overflowing === scrollable[side]) break;
          scrollable[side] = overflowing;
          setScrollable(side, overflowing);
        }
        updateHints(side);
      });
    };

    const onScroll = { left: () => updateHints('left'), right: () => updateHints('right') };
    gutters.left.addEventListener('scroll', onScroll.left, { passive: true });
    gutters.right.addEventListener('scroll', onScroll.right, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof view?.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(() => layout());
      observer.observe(imageEl);
      observer.observe(parent);
    }
    view?.addEventListener('resize', layout);

    layout();

    return () => {
      observer?.disconnect();
      view?.removeEventListener('resize', layout);
      gutters.left.removeEventListener('scroll', onScroll.left);
      gutters.right.removeEventListener('scroll', onScroll.right);
      gutters.left.remove();
      gutters.right.remove();
      hints.left.top.remove();
      hints.left.bottom.remove();
      hints.right.top.remove();
      hints.right.bottom.remove();
      restoreImage();
    };
  }, [imageEl, layerEl, mode, result, bubbleCount]);

  if (bubbleCount === 0 || !layerEl) return null;
  if (mode === 'danmaku') return null;

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
