'use client';

import React, { useCallback, useState } from 'react';

/** Storage flag telling us the reader has retired the manga hint for good. */
export const MANGA_HINT_SEEN_KEY = 'emm.manga.hintSeen';
export const MANGA_HINT_MESSAGE =
  '这里是漫画翻译 · 「覆盖」把译文放进气泡，「两侧」排在画面左右，「原文」收起译文';
/** The card is small on purpose: it explains the cluster, not the feature. */
export const MANGA_HINT_WIDTH = 240;

/** Whether the reader has permanently dismissed the hint. */
export const isMangaHintSeen = (): boolean => {
  try {
    return window.localStorage.getItem(MANGA_HINT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

export const markMangaHintSeen = (): void => {
  try {
    window.localStorage.setItem(MANGA_HINT_SEEN_KEY, '1');
  } catch {
    // Storage can be unavailable (private windows): the hint returns next time.
  }
};

interface MangaHintProps {
  /** Called after the card closes, whichever button was used. */
  onDismiss?: () => void;
}

/**
 * The first-run note beside the page-level control cluster. `知道了` hides it
 * for this visit; `不再提示` also writes `emm.manga.hintSeen`, so it never
 * returns. The card is otherwise passive: it never blocks page turns.
 */
const MangaHint: React.FC<MangaHintProps> = ({ onDismiss }) => {
  const [open, setOpen] = useState(() => !isMangaHintSeen());

  const close = useCallback(
    (remember: boolean) => {
      if (remember) markMangaHintSeen();
      setOpen(false);
      onDismiss?.();
    },
    [onDismiss],
  );

  if (!open) return null;

  return (
    <div
      role='note'
      aria-label={MANGA_HINT_MESSAGE}
      data-testid='manga-hint'
      className='pointer-events-auto absolute end-0 bottom-full mb-2 rounded-[6px] border border-study-ink/10 bg-study-page p-3'
      style={{ width: `${MANGA_HINT_WIDTH}px`, maxWidth: 'calc(100vw - 48px)' }}
    >
      <p className='text-study-ink text-[13px] leading-[1.55]' style={{ margin: 0 }}>
        {MANGA_HINT_MESSAGE}
      </p>
      <div className='mt-2 flex items-center justify-end gap-1'>
        <button
          type='button'
          onClick={() => close(false)}
          className='rounded-[4px] px-2 py-1 text-[12px] text-study-ink/55 hover:text-study-ink'
        >
          知道了
        </button>
        <button
          type='button'
          onClick={() => close(true)}
          className='rounded-[4px] px-2 py-1 text-[12px] text-study-ink/80 hover:bg-study-chip'
        >
          不再提示
        </button>
      </div>
    </div>
  );
};

export default MangaHint;
