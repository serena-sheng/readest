'use client';

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useReaderStore } from '@/store/readerStore';
import { list, remove, subscribe, type MarginNote } from '@/services/marginalia/store';
import MarginNoteItem, { MARGIN_NOTE_HEIGHT } from './MarginNoteItem';

/** Below this width the 72px gutter cannot exist beside the measure. */
export const NARROW_BREAKPOINT = 1200;
/** Width of the annotation gutter at the right of the reading measure. */
export const RAIL_WIDTH_WIDE = 160;
/** A 13" window still fits a real margin: 120px holds eight characters. */
export const RAIL_WIDTH_COMPACT = 120;
export const COMPACT_BREAKPOINT = 1400;
export const RAIL_WIDTH = RAIL_WIDTH_WIDE;
export const railWidthFor = (viewportWidth: number): number =>
  viewportWidth >= COMPACT_BREAKPOINT ? RAIL_WIDTH_WIDE : RAIL_WIDTH_COMPACT;
/** Length of the hairline that ties a note to its paragraph. */
export const LEAD_LENGTH = 16;
/** Breathing room between a note pushed down and the paragraph above it. */
const STACK_GAP = 8;

const BLOCK_TAGS: Record<string, true> = {
  ADDRESS: true,
  ASIDE: true,
  BLOCKQUOTE: true,
  DD: true,
  DIV: true,
  DL: true,
  DT: true,
  FIGCAPTION: true,
  FIGURE: true,
  H1: true,
  H2: true,
  H3: true,
  H4: true,
  H5: true,
  H6: true,
  LI: true,
  P: true,
  PRE: true,
  SECTION: true,
  TD: true,
};

const paragraphOf = (node: Node): HTMLElement | null => {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (element && !BLOCK_TAGS[element.tagName]) element = element.parentElement;
  return element;
};

/** The visible page's box in viewport coordinates. */
export interface PageRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The visible page, from the paginator's own box — not from the window's
 * `--reader-measure`. In a spread the paginator spans both columns, so this is
 * still the page area's outer edge; the rail is only shown for a single column.
 */
export const measurePageRect = (bookKey: string): PageRect | null => {
  const view = useReaderStore.getState().getView(bookKey);
  const renderer = view?.renderer;
  if (!renderer?.getBoundingClientRect) return null;
  const rect = renderer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
};

/**
 * The gutter's box beside the page's outer edge, or null when it would land on
 * the text. Clamping into the viewport first means a page that fills the
 * window yields null instead of a rail drawn over its last characters.
 */
export const placeRail = (
  page: PageRect,
  railWidth: number,
  isRtl: boolean,
  viewportWidth: number,
): { left: number; top: number; width: number; height: number } | null => {
  if (page.right <= page.left || page.bottom <= page.top) return null;
  const rawLeft = isRtl ? page.left - LEAD_LENGTH - railWidth : page.right + LEAD_LENGTH;
  // Keep the column on screen; the text never moves for it, so an off-screen
  // rail is not an option.
  const left = Math.min(Math.max(0, rawLeft), Math.max(0, viewportWidth - railWidth));
  const overlapsText = left < page.right && left + railWidth > page.left;
  if (overlapsText) return null;
  return { left, top: page.top, width: railWidth, height: page.bottom - page.top };
};

/**
 * Where a CFI lands vertically, measured against the page's top edge.
 *
 * The CFI resolves inside an iframe; its rect is viewport-relative, the rail's
 * is not, so the iframe's own offset is added and the page top subtracted.
 */
const measureFromView = (bookKey: string, anchorCfi: string, pageTop: number): number | null => {
  const view = useReaderStore.getState().getView(bookKey);
  if (!view?.resolveCFI || !view.renderer?.getContents) return null;
  try {
    const { index, anchor } = view.resolveCFI(anchorCfi);
    const contents = view.renderer.getContents();
    // A note whose section is not on screen has no margin position. Falling
    // back to another section would pin it to the wrong paragraph.
    const content = contents.find((candidate) => candidate.index === index);
    if (!content?.doc) return null;
    const range = anchor(content.doc);
    const block = paragraphOf(range.startContainer) ?? paragraphOf(range.endContainer);
    const rect = (block ?? range).getBoundingClientRect();
    const frame = content.doc.defaultView?.frameElement as HTMLElement | null;
    const frameTop = frame?.getBoundingClientRect().top ?? 0;
    return frameTop + rect.top - pageTop;
  } catch {
    return null;
  }
};

interface Placement {
  note: MarginNote;
  top: number;
}

/**
 * Vertical stacking: notes follow their paragraph, and when a note would land
 * on top of the one above it (same paragraph or a nearby one), it is pushed
 * down. Same-paragraph notes touch; different paragraphs keep an 8px gap.
 * Notes whose anchor was not measured are left out entirely — a note pinned to
 * the top edge would be a lie about where its paragraph is.
 */
const placeNotes = (notes: MarginNote[], tops: Record<string, number>): Placement[] => {
  const measured = notes.filter((note) => tops[note.anchorCfi] !== undefined);
  const sorted = [...measured].sort(
    (a, b) => tops[a.anchorCfi]! - tops[b.anchorCfi]! || a.at - b.at,
  );
  let lastAnchor: string | null = null;
  let lastTop = Number.NEGATIVE_INFINITY;
  return sorted.map((note) => {
    const anchorTop = tops[note.anchorCfi]!;
    const floor =
      lastTop === Number.NEGATIVE_INFINITY
        ? anchorTop
        : lastTop + MARGIN_NOTE_HEIGHT + (lastAnchor === note.anchorCfi ? 0 : STACK_GAP);
    const top = Math.max(anchorTop, floor);
    lastAnchor = note.anchorCfi;
    lastTop = top;
    return { note, top };
  });
};

interface MarginRailProps {
  bookKey: string;
  /** Test seam / alternate anchor source: offset within the rail, or null. */
  measureAnchor?: (anchorCfi: string) => number | null;
  /** Test seam / alternate page source; defaults to the paginator's box. */
  measurePage?: () => PageRect | null;
  /** Force the collapsed badge layout regardless of viewport width. */
  narrow?: boolean;
  /** Test seam: force the spread's window-edge dots. */
  spread?: boolean;
  /** Force reading direction; defaults to the book's view settings. */
  rtl?: boolean;
}

const MarginRail: React.FC<MarginRailProps> = ({
  bookKey,
  measureAnchor,
  measurePage,
  narrow: forceNarrow,
  spread: forceSpread,
  rtl,
}) => {
  const notes = useSyncExternalStore(
    subscribe,
    () => list(bookKey),
    () => list(bookKey),
  );
  const storeRtl = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.rtl ?? false);
  const isRtl = rtl ?? storeRtl;

  const [tick, setTick] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : NARROW_BREAKPOINT,
  );
  const viewportNarrow = viewportWidth < NARROW_BREAKPOINT;
  const railWidth = railWidthFor(viewportWidth);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<string | null>(null);

  // Follow page turns and scrolling: the note keeps its anchor and only its
  // transform changes.
  useEffect(() => {
    const update = () => setTick((value) => value + 1);
    const view = useReaderStore.getState().getView(bookKey);
    view?.addEventListener?.('relocate', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    // Scrolled mode scrolls inside the section iframes, whose scroll events do
    // not reach the host window.
    const contents = view?.renderer?.getContents?.() ?? [];
    for (const content of contents) {
      content.doc?.defaultView?.addEventListener('scroll', update, { passive: true });
    }
    return () => {
      view?.removeEventListener?.('relocate', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      for (const content of contents) {
        content.doc?.defaultView?.removeEventListener('scroll', update);
      }
    };
  }, [bookKey]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The page box and the rail's own box are only settled after mount; measure
  // once then instead of waiting for the first relocate.
  useEffect(() => {
    setTick((value) => value + 1);
  }, [bookKey]);

  const pageRect = useMemo(() => {
    const measure = measurePage ?? (() => measurePageRect(bookKey));
    return measure();
    // `tick` is the measurement invalidation signal (relocate, scroll, mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, measurePage, tick]);

  const spread = useMemo(() => {
    if (forceSpread !== undefined) return forceSpread;
    const view = useReaderStore.getState().getView(bookKey);
    return (view?.renderer?.columnCount ?? 1) > 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, forceSpread, tick]);

  const tops = useMemo(() => {
    const result: Record<string, number> = {};
    const pageTop = pageRect?.top ?? 0;
    for (const note of notes) {
      const top = measureAnchor
        ? measureAnchor(note.anchorCfi)
        : measureFromView(bookKey, note.anchorCfi, pageTop);
      if (top != null && Number.isFinite(top)) result[note.anchorCfi] = top;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, measureAnchor, bookKey, pageRect, tick]);

  const placements = useMemo(() => placeNotes(notes, tops), [notes, tops]);

  const badgeGroups = useMemo(() => {
    const groups: Array<{ anchorCfi: string; top: number; notes: MarginNote[] }> = [];
    for (const note of notes) {
      const top = tops[note.anchorCfi];
      // An unmeasured anchor has no place on the page; its dot would point at
      // the wrong paragraph.
      if (top === undefined) continue;
      const existing = groups.find((group) => group.anchorCfi === note.anchorCfi);
      if (existing) existing.notes.push(note);
      else groups.push({ anchorCfi: note.anchorCfi, top, notes: [note] });
    }
    return groups.sort((a, b) => a.top - b.top);
  }, [notes, tops]);

  // `narrow` only forces the badge layout on; it never keeps the one-sided
  // gutter alive for a spread.
  const collapsed = forceNarrow === true || viewportNarrow || spread;

  if (notes.length === 0 || !pageRect) return null;

  const deleteNote = (id: string) => {
    remove(bookKey, id);
    if (openNoteId === id) setOpenNoteId(null);
  };

  if (collapsed) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className='pointer-events-none fixed z-[25]'
        data-testid='margin-rail'
        data-mode='badges'
        style={{
          top: pageRect.top,
          height: pageRect.bottom - pageRect.top,
          width: 8,
          // A spread has no gutter of its own: the dots sit at the window edge
          // and open a side sheet instead of drawing a column over a page.
          [isRtl ? 'left' : 'right']: 4,
        }}
      >
        {badgeGroups.map((group) => (
          <div
            key={group.anchorCfi}
            className='pointer-events-auto absolute'
            style={{ top: 0, transform: `translateY(${group.top}px)`, width: 8 }}
          >
            <button
              type='button'
              className='bg-study-ink/35 hover:bg-study-ink/70 absolute h-2 w-2 cursor-pointer rounded-full transition-colors duration-150 ease-study'
              style={{ insetInlineStart: -4, top: 6 }}
              data-testid='margin-badge'
              data-anchor-cfi={group.anchorCfi}
              aria-label={`${group.notes.length} 条批注`}
              aria-expanded={openBadge === group.anchorCfi}
              onClick={() =>
                setOpenBadge((current) => (current === group.anchorCfi ? null : group.anchorCfi))
              }
            />
            {openBadge === group.anchorCfi && (
              <div
                className='bg-base-100 border-study-ink/12 absolute w-[240px] rounded-lg border p-2 shadow-sm'
                data-testid='margin-badge-popup'
                style={{ insetInlineEnd: 8, top: -4, zIndex: 40 }}
              >
                {group.notes.map((note) => (
                  <MarginNoteItem
                    key={note.id}
                    note={note}
                    expanded
                    variant='popup'
                    onDelete={() => deleteNote(note.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  const layout = placeRail(pageRect, railWidth, isRtl, viewportWidth);
  // No room beside the page means no rail: drawing it over the text is worse
  // than hiding the trace until the window has a gutter again.
  if (!layout) return null;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className='pointer-events-none fixed z-[25]'
      data-testid='margin-rail'
      data-mode='rail'
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
      }}
    >
      {placements.map(({ note, top }) => (
        <div
          key={note.id}
          className='pointer-events-auto absolute'
          data-testid='margin-note-anchor'
          data-top={top}
          style={{ top: 0, transform: `translateY(${top}px)`, width: railWidth }}
        >
          <span
            aria-hidden='true'
            data-testid='margin-note-leader'
            className='absolute h-px'
            style={{
              top: 10,
              width: LEAD_LENGTH,
              [isRtl ? 'left' : 'right']: '100%',
              background: 'rgba(26,22,16,.28)',
            }}
          />
          <MarginNoteItem
            note={note}
            expanded={openNoteId === note.id}
            onToggle={() => setOpenNoteId((current) => (current === note.id ? null : note.id))}
            onDelete={() => deleteNote(note.id)}
          />
        </div>
      ))}
    </div>
  );
};

export default MarginRail;
