'use client';

import React from 'react';
import { MdImage } from 'react-icons/md';

import type { FoliateView } from '@/types/view';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';
import { useMangaTranslation } from '../../hooks/useMangaTranslation';
import MangaOverlay from './MangaOverlay';

interface MangaTranslateTogglerProps {
  bookKey: string;
  view: FoliateView | null;
}

/**
 * Reader toolbar entry for manga translation. It owns the overlay's lifetime:
 * the layer is portalled into the page image's own document, so the header
 * component hosting this button is the natural mount point.
 */
const MangaTranslateToggler: React.FC<MangaTranslateTogglerProps> = ({ bookKey, view }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { available, loading, translated, imageEl, result, toggle } = useMangaTranslation(
    bookKey,
    view,
  );

  if (!available) return null;

  return (
    <>
      <Button
        icon={
          <MdImage
            size={iconSize18}
            className={translated ? 'fill-blue-500' : 'fill-base-content'}
          />
        }
        onClick={() => void toggle()}
        disabled={loading}
        label={translated ? _('Remove Manga Translation') : _('Translate Manga Page')}
      />
      {imageEl && result && <MangaOverlay imageEl={imageEl} result={result} />}
    </>
  );
};

export default MangaTranslateToggler;
