'use client';

import React from 'react';
import { MdImage } from 'react-icons/md';

import type { FoliateView } from '@/types/view';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';
import { useMangaTranslation, type MangaTranslationMode } from '../../hooks/useMangaTranslation';
import MangaOverlay from './MangaOverlay';

interface MangaTranslateTogglerProps {
  bookKey: string;
  view: FoliateView | null;
}

const STATE_LABELS: Record<MangaTranslationMode, string> = {
  off: '原',
  bubble: '漫',
  danmaku: '幕',
};

const STATE_TITLES: Record<MangaTranslationMode, string> = {
  off: 'Translate Manga Page',
  bubble: 'Manga Translation: Bubble',
  danmaku: 'Manga Translation: Danmaku',
};

const BADGE_STYLES: Record<MangaTranslationMode, string> = {
  // 漫: white ground, magenta text; 幕: magenta ground, white text (primary);
  // 原: muted grey.
  bubble: 'bg-white text-[#F0457E]',
  danmaku: 'bg-[#F0457E] text-white',
  off: 'bg-base-300/70 text-base-content/60',
};

const ICON_STYLES: Record<MangaTranslationMode, string> = {
  bubble: 'fill-[#F0457E]',
  danmaku: 'fill-[#F0457E]',
  off: 'fill-base-content/60',
};

/**
 * Reader toolbar entry for manga translation. It owns the overlay's lifetime:
 * the layer is portalled into the page image's own document, so the header
 * component hosting this button is the natural mount point.
 */
const MangaTranslateToggler: React.FC<MangaTranslateTogglerProps> = ({ bookKey, view }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { available, loading, mode, imageEl, result, cycleMode } = useMangaTranslation(
    bookKey,
    view,
  );

  if (!available) return null;

  return (
    <>
      <Button
        icon={
          <span className='flex flex-col items-center justify-center leading-none'>
            <MdImage size={iconSize18} className={ICON_STYLES[mode]} />
            <span
              className={`mt-px rounded-sm px-1 text-[8px] font-semibold leading-[9px] ${BADGE_STYLES[mode]}`}
            >
              {STATE_LABELS[mode]}
            </span>
          </span>
        }
        onClick={() => void cycleMode()}
        disabled={loading}
        label={`${STATE_LABELS[mode]} · ${_(STATE_TITLES[mode])}`}
      />
      {imageEl && result && mode !== 'off' && (
        <MangaOverlay imageEl={imageEl} result={result} mode={mode} />
      )}
    </>
  );
};

export default MangaTranslateToggler;
