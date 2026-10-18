'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { saveNote } from '@/services/ai/localNotes';
import { getRangeRectInWebview } from '@/utils/sel';
import type { Rect, TextSelection } from '@/utils/sel';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';

// Block-level elements a reader selects inside. The locator is approximate by
// design (see the notes contract): `<href>#<n>` where `n` is the 0-based index
// of the block that contains the selection start.
const PARAGRAPH_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre';

/** 0-based index of the block element around `range`'s start, -1 when unknown. */
export const approximateParagraphIndex = (range: Range): number => {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return -1;
  const blocks = Array.from(doc.querySelectorAll(PARAGRAPH_SELECTOR));
  if (blocks.length === 0) return -1;
  const start = range.startContainer;
  const containing = blocks.findIndex((block) => block.contains(start));
  if (containing !== -1) return containing;
  // The start can sit on the body itself (a selection that begins between
  // blocks); count what ends before it.
  let preceding = 0;
  for (const block of blocks) {
    if (block.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) preceding++;
  }
  return preceding;
};

export const buildNoteLocator = (range: Range | undefined, href?: string): string => {
  if (!range) return href ?? '';
  const index = approximateParagraphIndex(range);
  if (index < 0) return href ?? '';
  return `${href ?? ''}#${index}`;
};

const GAP = 8;
const MARGIN = 12;
const MAX_PILL_WIDTH = 260;

interface SelectionActionsProps {
  selection: TextSelection;
  bookTitle: string;
  /** Section href, so the note locator is `<href>#<paragraph index>`. */
  href?: string;
  /**
   * Viewport y of the reader's own selection toolbar, when it is open. The
   * pill stacks 8px above it instead of covering it — both surfaces belong to
   * the same selection, and overlapping them would hide the toolbar's tools.
   */
  avoidTop?: number;
  onAsk: (text: string) => void;
  onDismiss: () => void;
}

interface Size {
  width: number;
  height: number;
}

const toast = (type: 'info' | 'error', message: string) =>
  eventDispatcher.dispatch('toast', { type, message, timeout: 2500 });

const SelectionActions: React.FC<SelectionActionsProps> = ({
  selection,
  bookTitle,
  href,
  avoidTop,
  onAsk,
  onDismiss,
}) => {
  const text = selection.text.replace(/\s+/g, ' ').trim();
  const [mode, setMode] = useState<'actions' | 'note'>('actions');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const boxRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    }
  }, []);

  useLayoutEffect(measure, [measure, mode, text]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // The rect is in the outer webview's viewport coordinates, matching where a
  // fixed-position pill lands (foliate scales and offsets its iframe ranges).
  const rect = useMemo<Rect | null>(() => {
    if (selection.rect) return selection.rect;
    if (!selection.range) return null;
    try {
      return getRangeRectInWebview(selection.range);
    } catch {
      return null;
    }
  }, [selection]);

  const placement = useMemo(() => {
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const width = Math.min(size.width || 200, MAX_PILL_WIDTH);
    const height = size.height || (mode === 'note' ? 200 : 38);
    if (!rect) {
      return { left: MARGIN, top: MARGIN };
    }
    const left = Math.max(
      MARGIN,
      Math.min(
        rect.left + (rect.right - rect.left) / 2 - width / 2,
        viewportWidth - MARGIN - width,
      ),
    );
    // Default: 8px above the selection. The reader's own toolbar can occupy
    // that spot, so the pill moves up to stay 8px above *it* when it is there.
    let top = rect.top - GAP - height;
    if (avoidTop !== undefined && top + height > avoidTop) top = avoidTop - GAP - height;
    // Above viewport → flip below the selection and clamp.
    if (top < MARGIN) {
      top = Math.max(MARGIN, Math.min(rect.bottom + GAP, viewportHeight - MARGIN - height));
    }
    return { left, top };
  }, [rect, size, mode, avoidTop]);

  // Close on outside press, scroll, Esc, and (through the parent) a cleared
  // selection. Scroll events inside foliate's iframe do not bubble to the host
  // window, so the range's own document/window gets the listeners too.
  useEffect(() => {
    const ownerDoc = selection.range?.startContainer.ownerDocument;
    const ownerWin = ownerDoc?.defaultView ?? (typeof window === 'undefined' ? null : window);
    const close = () => dismissRef.current();
    const onKeyDown = (event: Event) => {
      const { key } = event as KeyboardEvent;
      if (key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target;
      // Synthetic/document-level presses (the reader arms gestures on the
      // document) are not a press on the page chrome, and a press inside the
      // reader's own selection popup acts on this same selection — dismissing
      // the pill would clear the selection before the click lands.
      if (!(target instanceof Element)) return;
      if (boxRef.current?.contains(target)) return;
      if (target.closest('#popup-container, .popup-container')) return;
      close();
    };

    const targets: EventTarget[] = [];
    const add = (target: EventTarget | null | undefined, type: string, handler: EventListener) => {
      if (!target) return;
      target.addEventListener(type, handler, true);
      targets.push(target);
    };
    const remove = () => {
      for (const target of targets) {
        target.removeEventListener('pointerdown', onPointerDown, true);
        target.removeEventListener('scroll', close, true);
        target.removeEventListener('keydown', onKeyDown, true);
      }
    };

    add(typeof window === 'undefined' ? null : window, 'pointerdown', onPointerDown);
    add(ownerWin, 'pointerdown', onPointerDown);
    add(typeof document === 'undefined' ? null : document, 'pointerdown', onPointerDown);
    add(ownerWin, 'scroll', close);
    add(ownerDoc, 'scroll', close);
    add(typeof window === 'undefined' ? null : window, 'scroll', close);
    add(ownerWin, 'keydown', onKeyDown);
    if (ownerDoc && ownerDoc !== document) add(ownerDoc, 'keydown', onKeyDown);
    add(typeof document === 'undefined' ? null : document, 'keydown', onKeyDown);

    return remove;
  }, [selection.range]);

  if (text.length < 2 || typeof document === 'undefined') return null;

  const handleCopy = () => {
    void writeTextToClipboard(text).then((copied) => {
      if (!copied) toast('error', '复制失败');
    });
    dismissRef.current();
  };

  const handleNoteSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveNote({
        book: bookTitle,
        quote: text,
        note: note.trim(),
        locator: buildNoteLocator(selection.range, href),
      });
      // Surfaces that show saved ideas (the reader's idea panel) refresh on
      // this event instead of polling the local service.
      window.dispatchEvent(new CustomEvent('emm-note-saved'));
      toast('info', '已记下');
      setMode('actions');
      setNote('');
      dismissRef.current();
    } catch {
      // The local service may be down; the panel stays open so the text is
      // not lost, and the failure is reported without throwing at the reader.
      toast('error', '没记下：本地服务未连接');
    } finally {
      setSaving(false);
    }
  };

  const buttonClass =
    'h-7 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-[12.5px] leading-none ' +
    'text-base-content/80 transition-colors duration-150 hover:bg-base-content/[0.06] ' +
    'hover:text-base-content active:bg-base-content/10 motion-reduce:transition-none';

  return createPortal(
    <div
      data-selection-actions='true'
      role='toolbar'
      aria-label='选区操作'
      ref={boxRef}
      className='fixed z-[60] font-sans'
      style={{ left: placement.left, top: placement.top }}
    >
      {mode === 'actions' ? (
        <div
          className='flex items-center gap-0.5 rounded-field border border-base-content/10 bg-base-100 p-[3px] shadow-lg'
          style={{ maxWidth: MAX_PILL_WIDTH }}
        >
          <button
            type='button'
            className={buttonClass}
            onClick={() => {
              onAsk(text);
              dismissRef.current();
            }}
          >
            问 AI
          </button>
          <button type='button' className={buttonClass} onClick={() => setMode('note')}>
            记想法
          </button>
          <button type='button' className={buttonClass} onClick={handleCopy}>
            复制
          </button>
        </div>
      ) : (
        <div className='w-[300px] max-w-[calc(100vw-24px)] rounded-box border border-base-content/10 bg-base-100 p-3.5 shadow-lg'>
          <p className='mb-2.5 line-clamp-4 border-s-2 border-primary/70 ps-2.5 font-serif text-xs leading-relaxed text-base-content/70'>
            {text}
          </p>
          <textarea
            aria-label='想法'
            className='textarea textarea-bordered w-full resize-y font-serif text-[13px] leading-relaxed'
            rows={3}
            placeholder='写点什么…'
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleNoteSave();
              }
            }}
          />
          <div className='mt-2.5 flex justify-end gap-2'>
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={() => {
                setMode('actions');
                setNote('');
              }}
            >
              取消
            </button>
            <button
              type='button'
              className='btn btn-primary btn-xs'
              disabled={saving}
              onClick={() => void handleNoteSave()}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default SelectionActions;
