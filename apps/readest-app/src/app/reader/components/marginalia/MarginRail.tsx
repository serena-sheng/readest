'use client';

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useReaderStore } from '@/store/readerStore';
import { list, remove, subscribe, type MarginNote } from '@/services/marginalia/store';
import MarginNoteItem, { MARGIN_NOTE_HEIGHT } from './MarginNoteItem';

/** Below this width the 72px gutter cannot exist beside the measure. */
export const NARROW_BREAKPOINT = 1200;
/** Width of the annotation gutter at the right of the reading measure. */
export const RAIL_WIDTH = 72;
/** Length of the hairline that ties a note to its paragraph. */
export const LEAD_LENGTH = 24;
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

/**
 * Where a CFI lands vertically, measured against the rail's own top edge.
 *
 * The CFI resolves inside an iframe; its rect is viewport-relative, the rail's
 * is not, so the iframe's own offset is added and the rail top subtracted.
 */
const measureFromView = (bookKey: string, anchorCfi: string, railTop: number): number | null => {
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
    return frameTop + rect.top - railTop;
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
 */
const placeNotes = (notes: MarginNote[], tops: Record<string, number>): Placement[] => {
  const sorted = [...notes].sort(
    (a, b) => (tops[a.anchorCfi] ?? 0) - (tops[b.anchorCfi] ?? 0) || a.at - b.at,
  );
  let lastAnchor: string | null = null;
  let lastTop = Number.NEGATIVE_INFINITY;
  return sorted.map((note) => {
    const anchorTop = tops[note.anchorCfi] ?? 0;
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
  /** Force the collapsed badge layout regardless of viewport width. */
  narrow?: boolean;
  /** Force reading direction; defaults to the book's view settings. */
  rtl?: boolean;
}

const MarginRail: React.FC<MarginRailProps> = ({
  bookKey,
  measureAnchor,
  narrow: forceNarrow,
  rtl,
}) => {
  const notes = useSyncExternalStore(
    subscribe,
    () => list(bookKey),
    () => list(bookKey),
  );
  const storeRtl = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.rtl ?? false);
  const isRtl = rtl ?? storeRtl;

  const railRef = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0);
  const [viewportNarrow, setViewportNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT,
  );
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<string | null>(null);

  const collapsed = forceNarrow ?? viewportNarrow;

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
    const onResize = () => setViewportNarrow(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The rail's rect is only available after mount; measure once then.
  useEffect(() => {
    setTick((value) => value + 1);
  }, [bookKey]);

  const tops = useMemo(() => {
    const result: Record<string, number> = {};
    const railTop = railRef.current?.getBoundingClientRect().top ?? 0;
    for (const note of notes) {
      const top = measureAnchor
        ? measureAnchor(note.anchorCfi)
        : measureFromView(bookKey, note.anchorCfi, railTop);
      if (top != null && Number.isFinite(top)) result[note.anchorCfi] = top;
    }
    return result;
    // `tick` is the measurement invalidation signal (relocate, scroll, mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, measureAnchor, bookKey, tick]);

  const placements = useMemo(() => placeNotes(notes, tops), [notes, tops]);

  const badgeGroups = useMemo(() => {
    const groups: Array<{ anchorCfi: string; top: number; notes: MarginNote[] }> = [];
    for (const note of notes) {
      const existing = groups.find((group) => group.anchorCfi === note.anchorCfi);
      if (existing) existing.notes.push(note);
      else
        groups.push({ anchorCfi: note.anchorCfi, top: tops[note.anchorCfi] ?? 0, notes: [note] });
    }
    return groups.sort((a, b) => a.top - b.top);
  }, [notes, tops]);

  if (notes.length === 0) return null;

  const deleteNote = (id: string) => {
    remove(bookKey, id);
    if (openNoteId === id) setOpenNoteId(null);
  };

  if (collapsed) {
    return (
      <div
        ref={railRef}
        dir={isRtl ? 'rtl' : 'ltr'}
        className='pointer-events-none absolute z-[25]'
        data-testid='margin-rail'
        data-mode='badges'
        style={{
          top: 0,
          bottom: 0,
          width: 8,
          [isRtl ? 'left' : 'right']: 'calc((100% - var(--reader-measure)) / 2 - 4px)',
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

  return (
    <div
      ref={railRef}
      dir={isRtl ? 'rtl' : 'ltr'}
      className='pointer-events-none absolute z-[25]'
      data-testid='margin-rail'
      data-mode='rail'
      style={{
        top: 0,
        bottom: 0,
        width: RAIL_WIDTH,
        [isRtl ? 'left' : 'right']: `calc((100% - var(--reader-measure)) / 2 - ${
          RAIL_WIDTH + LEAD_LENGTH
        }px)`,
      }}
    >
      {placements.map(({ note, top }) => (
        <div
          key={note.id}
          className='pointer-events-auto absolute'
          data-testid='margin-note-anchor'
          data-top={top}
          style={{ top: 0, transform: `translateY(${top}px)`, width: RAIL_WIDTH }}
        >
          <span
            aria-hidden='true'
            data-testid='margin-note-leader'
            className='absolute h-px'
            style={{
              top: 10,
              width: LEAD_LENGTH,
              [isRtl ? 'left' : 'right']: '100%',
              background: 'rgba(26,22,16,.16)',
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
