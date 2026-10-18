import { useEffect } from 'react';

import { Book } from '@/types/book';
import { resolveCoverAmbientColor } from '@/utils/coverAmbient';

/**
 * Publishes the open book's cover colour as `--emm-ambient` on `.reader-page`
 * (the emm theme's canvas consumes it in globals.css). The variable lives on
 * the reader page element, so leaving the reader drops it with the DOM.
 *
 * The sample runs once per bookKey; `resolveCoverAmbientColor` caches both
 * successes and failures. A missing cover, a failed load or an unsampleable
 * canvas simply clears the variable — the canvas keeps its plain base tone.
 */
export const useCoverAmbient = (bookKey: string | undefined, book: Book | null | undefined) => {
  const coverUrl = book?.metadata?.coverImageUrl || book?.coverImageUrl || '';

  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.reader-page');
    if (!page) return;

    if (!bookKey || !coverUrl) {
      page.style.removeProperty('--emm-ambient');
      return;
    }

    let cancelled = false;
    void resolveCoverAmbientColor(bookKey, coverUrl).then((color) => {
      if (cancelled) return;
      if (color) {
        page.style.setProperty('--emm-ambient', color);
      } else {
        page.style.removeProperty('--emm-ambient');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bookKey, coverUrl]);
};
