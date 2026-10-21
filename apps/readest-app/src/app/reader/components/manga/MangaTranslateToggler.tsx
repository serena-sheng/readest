'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { FoliateView } from '@/types/view';
import type { MangaTranslationMode } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import Dialog from '@/components/Dialog';
import { useMangaTranslation } from '../../hooks/useMangaTranslation';
import MangaControlCluster from './MangaControlCluster';
import MangaHint from './MangaHint';
import MangaOverlay from './MangaOverlay';
import MangaStatusBar from './MangaStatusBar';

interface MangaTranslateTogglerProps {
  bookKey: string;
  view: FoliateView | null;
}

/**
 * Reader entry point for manga translation. It owns the overlay's lifetime and
 * mounts the page-level control cluster into the reading area (`gridcell`), so
 * the reader's controls sit with the artwork instead of inside the toolbar.
 */
const MangaTranslateToggler: React.FC<MangaTranslateTogglerProps> = ({ bookKey, view }) => {
  const _ = useTranslation();
  const setSettingsDialogOpen = useSettingsStore((state) => state.setSettingsDialogOpen);
  const setSettingsDialogBookKey = useSettingsStore((state) => state.setSettingsDialogBookKey);

  const [seenImage, setSeenImage] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const handleNarrowFallback = useCallback(
    (message: string) => {
      void eventDispatcher.dispatch('hint', { bookKey, message, timeout: 4000 });
    },
    [bookKey],
  );

  const {
    available,
    loading,
    mode,
    imageEl,
    result,
    status,
    danmakuDisabledReason,
    needsModelSetup,
    toggle,
    setMode,
    stop,
    retry,
    retranslate,
    dismissStatus,
    dismissModelSetup,
    fitPage,
  } = useMangaTranslation(bookKey, view, { onNarrowFallback: handleNarrowFallback });

  // A book that has shown a manga page keeps the cluster on image-less pages
  // (covers, colophons): a vanishing control reads as a broken feature.
  useEffect(() => {
    if (available) setSeenImage(true);
  }, [available]);

  // Both the cluster and the inline status belong to the reading area.
  useEffect(() => {
    setHost(document.getElementById(`gridcell-${bookKey}`));
  }, [bookKey]);

  const selectMode = useCallback(
    (next: MangaTranslationMode) => {
      void setMode(next);
    },
    [setMode],
  );

  if (!seenImage && !available) return null;

  return (
    <>
      {host &&
        createPortal(
          <MangaControlCluster
            available={available}
            loading={loading}
            mode={mode}
            danmakuDisabledReason={danmakuDisabledReason}
            bubbles={result?.bubbles ?? []}
            onTranslate={() => void toggle()}
            onSelectMode={selectMode}
            onFitPage={fitPage}
            onRetranslate={() => void retranslate()}
            onClose={() => selectMode('off')}
            hint={available ? <MangaHint /> : null}
          />,
          host,
        )}

      {imageEl && result && mode !== 'off' && (
        <MangaOverlay imageEl={imageEl} result={result} mode={mode} />
      )}

      {host &&
        createPortal(
          <MangaStatusBar
            status={status}
            onStop={stop}
            onRetry={() => void retry()}
            onDismiss={dismissStatus}
          />,
          host,
        )}

      <Dialog
        isOpen={needsModelSetup}
        title={_('漫画翻译还没连上模型')}
        onClose={dismissModelSetup}
        boxClassName='sm:h-auto! sm:w-[420px]! sm:max-w-[90vw]!'
      >
        {needsModelSetup && (
          <div className='flex flex-col gap-4 pb-4'>
            <p className='text-base-content/70 text-sm'>
              {_('在设置里添加一个能看图的模型，再回来翻译这一页。')}
            </p>
            <div className='flex justify-end gap-2'>
              <button type='button' className='btn btn-ghost btn-sm' onClick={dismissModelSetup}>
                {_('以后再说')}
              </button>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => {
                  dismissModelSetup();
                  setSettingsDialogBookKey(bookKey);
                  setSettingsDialogOpen(true);
                }}
              >
                {_('去设置')}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
};

export default MangaTranslateToggler;
