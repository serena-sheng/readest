'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { MangaTranslationStatus } from '../../hooks/useMangaTranslation';

/** The progress bar only appears once the caches have missed and the request
 *  is actually waiting on the model; a cache hit must not flash it. */
export const MANGA_STATUS_DELAY_MS = 250;
/** How long the "no text" notice stays up; it is informational, not a result. */
export const MANGA_EMPTY_STATUS_TIMEOUT_MS = 2500;
/** Elapsed seconds are appended only when the wait is long enough to wonder. */
export const MANGA_ELAPSED_THRESHOLD_SECONDS = 8;

export interface MangaStatusBarProps {
  status: MangaTranslationStatus | null;
  onStop?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const formatElapsed = (status: { startedAt: number }, now: number): number =>
  Math.max(0, Math.floor((now - status.startedAt) / 1000));

/**
 * Inline translation feedback at the top centre of the reading area. It is
 * owned by the reader pane (not the global toast slot) so a progress bar, an
 * empty notice and an error can't displace each other or cover the artwork.
 */
const MangaStatusBar: React.FC<MangaStatusBarProps> = ({ status, onStop, onRetry, onDismiss }) => {
  const _ = useTranslation();
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const kind = status?.kind ?? null;
  const startedAt = status?.kind === 'translating' ? status.startedAt : 0;

  useEffect(() => {
    if (!kind) {
      setVisible(false);
      return;
    }

    if (kind === 'translating') {
      setVisible(false);
      setNow(Date.now());
      const showTimer = setTimeout(() => {
        setVisible(true);
        setNow(Date.now());
      }, MANGA_STATUS_DELAY_MS);
      return () => clearTimeout(showTimer);
    }

    setVisible(true);
    setNow(Date.now());
    if (kind === 'empty') {
      const hideTimer = setTimeout(() => {
        setVisible(false);
        dismissRef.current?.();
      }, MANGA_EMPTY_STATUS_TIMEOUT_MS);
      return () => clearTimeout(hideTimer);
    }
    return undefined;
  }, [kind, startedAt]);

  const elapsed = status?.kind === 'translating' ? formatElapsed(status, now) : 0;
  const showElapsed = status?.kind === 'translating' && elapsed >= MANGA_ELAPSED_THRESHOLD_SECONDS;

  useEffect(() => {
    if (status?.kind !== 'translating') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status?.kind, startedAt]);

  if (!status || !visible) return null;

  const isError = status.kind === 'error';
  const message =
    status.kind === 'translating'
      ? showElapsed
        ? _('正在翻译这一页…') + ` · ${elapsed} ` + _('秒')
        : _('正在翻译这一页…')
      : status.kind === 'empty'
        ? _('本页没有文字')
        : status.message;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-manga-status={status.kind}
      className='pointer-events-auto absolute left-1/2 top-3 z-20 flex h-9 -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-sm'
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-base-100) 92%, transparent)',
        border: '1px solid var(--color-base-300)',
        boxShadow: '0 8px 24px rgba(0,0,0,.12)',
      }}
    >
      <span className='text-base-content'>{message}</span>
      {status.kind === 'translating' && (
        <button className='link link-hover shrink-0 text-sm font-medium' onClick={onStop}>
          {_('停止')}
        </button>
      )}
      {isError && (
        <span className='flex shrink-0 items-center gap-2'>
          <button className='link link-hover text-sm font-medium' onClick={onRetry}>
            {_('重试')}
          </button>
          <button className='link link-hover text-base-content/60 text-sm' onClick={onDismiss}>
            {_('关闭')}
          </button>
        </span>
      )}
    </div>
  );
};

export default MangaStatusBar;
