'use client';

import React, { useEffect } from 'react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { writeTextToClipboard } from '@/utils/clipboard';
import type { MarginNote } from '@/services/marginalia/store';

/** Collapsed height of one rail note: three 12/18 lines plus the tap padding. */
export const MARGIN_NOTE_HEIGHT = 62;

interface MarginNoteItemProps {
  note: MarginNote;
  expanded?: boolean;
  onToggle?: () => void;
  onDelete: () => void;
  /**
   * `rail` opens the full text as a floating panel beside the note.
   * `popup` is already inside a floating list, so the text stays in flow.
   */
  variant?: 'rail' | 'popup';
}

const MarginNoteItem: React.FC<MarginNoteItemProps> = ({
  note,
  expanded = false,
  onToggle,
  onDelete,
  variant = 'rail',
}) => {
  const _ = useTranslation();

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, onToggle]);

  return (
    <div
      className={clsx('relative min-w-0', variant === 'popup' && 'px-3 py-2')}
      data-testid='margin-note'
      data-note-id={note.id}
      data-note-kind={note.kind}
    >
      <button
        type='button'
        className={clsx(
          'text-study-ink/60 hover:text-study-ink/80 block w-full cursor-pointer text-start',
          'transition-colors duration-150 ease-study',
          variant === 'popup' && 'text-[13px] leading-[20px]',
        )}
        style={variant === 'rail' ? { fontSize: 12, lineHeight: '18px' } : undefined}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          data-testid='margin-note-text'
          className={clsx(
            variant === 'rail' && !expanded && 'line-clamp-3',
            expanded && 'break-words',
          )}
        >
          {note.text}
        </span>
      </button>

      {expanded && (
        <div
          className={clsx(
            'text-study-ink/80 bg-base-100 border-study-ink/12',
            variant === 'rail'
              ? 'absolute top-0 z-30 w-[240px] rounded-lg border p-3 shadow-sm'
              : 'mt-2 border-t pt-2',
          )}
          data-testid='margin-note-panel'
          style={variant === 'rail' ? { insetInlineEnd: '100%', marginInlineEnd: 8 } : undefined}
        >
          {variant === 'rail' && (
            <p className='text-[13px] leading-[20px] break-words whitespace-pre-wrap'>
              {note.text}
            </p>
          )}
          <div className={clsx('flex items-center gap-4', variant === 'rail' && 'mt-3')}>
            <button
              type='button'
              className='text-meta text-study-ink/60 hover:text-study-ink cursor-pointer transition-colors duration-150 ease-study'
              data-testid='margin-note-copy'
              onClick={() => void writeTextToClipboard(note.text)}
            >
              {_('Copy')}
            </button>
            <button
              type='button'
              className='text-meta text-study-ink/60 hover:text-study-ink cursor-pointer transition-colors duration-150 ease-study'
              data-testid='margin-note-delete'
              onClick={onDelete}
            >
              {_('Delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarginNoteItem;
