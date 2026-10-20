'use client';

import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { MangaTranslationStatus } from '../../hooks/useMangaTranslation';
import TaskStatusBar, {
  TASK_ELAPSED_THRESHOLD_SECONDS,
  TASK_NOTICE_TIMEOUT_MS,
  TASK_STATUS_DELAY_MS,
  type TaskStatus,
} from '../TaskStatusBar';

/** The progress bar only appears once the caches have missed and the request
 *  is actually waiting on the model; a cache hit must not flash it. */
export const MANGA_STATUS_DELAY_MS = TASK_STATUS_DELAY_MS;
/** How long the "no text" notice stays up; it is informational, not a result. */
export const MANGA_EMPTY_STATUS_TIMEOUT_MS = TASK_NOTICE_TIMEOUT_MS;
/** Elapsed seconds are appended only when the wait is long enough to wonder. */
export const MANGA_ELAPSED_THRESHOLD_SECONDS = TASK_ELAPSED_THRESHOLD_SECONDS;

export interface MangaStatusBarProps {
  status: MangaTranslationStatus | null;
  onStop?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Manga's wording for the shared task status bar. The layout, timing and
 * actions live in TaskStatusBar so manga and text translation cannot drift.
 */
const MangaStatusBar: React.FC<MangaStatusBarProps> = ({ status, onStop, onRetry, onDismiss }) => {
  const _ = useTranslation();

  const taskStatus: TaskStatus | null = !status
    ? null
    : status.kind === 'translating'
      ? { kind: 'progress', message: _('正在翻译这一页…'), startedAt: status.startedAt }
      : status.kind === 'empty'
        ? { kind: 'notice', message: _('本页没有文字') }
        : status;

  return (
    <TaskStatusBar
      status={taskStatus}
      onStop={onStop}
      onRetry={onRetry}
      onDismiss={onDismiss}
      statusAttribute='data-manga-status'
      delayMs={MANGA_STATUS_DELAY_MS}
      noticeTimeoutMs={MANGA_EMPTY_STATUS_TIMEOUT_MS}
      elapsedThresholdSeconds={MANGA_ELAPSED_THRESHOLD_SECONDS}
    />
  );
};

export default MangaStatusBar;
