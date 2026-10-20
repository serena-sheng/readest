'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';

/** The progress bar only appears once the caches have missed and the request
 *  is actually waiting on the model; a cache hit must not flash it. */
export const TASK_STATUS_DELAY_MS = 250;
/** How long an informational notice stays up; it is not a result. */
export const TASK_NOTICE_TIMEOUT_MS = 2500;
/** Elapsed seconds are appended only when the wait is long enough to wonder. */
export const TASK_ELAPSED_THRESHOLD_SECONDS = 8;

/**
 * Inline task feedback for the reading area. Every producer uses the same
 * shape, so a progress bar, a notice and a failure can't displace each other.
 */
export type TaskStatus =
  | { kind: 'progress'; message: string; startedAt: number }
  | { kind: 'notice'; message: string }
  /** `detail` is the secondary line: what failed, under why it failed. */
  | { kind: 'error'; message: string; detail?: string };

export interface TaskStatusAction {
  label: string;
  onClick: () => void;
}

export interface TaskStatusBarProps {
  status: TaskStatus | null;
  onStop?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** An error-specific action beside Retry, e.g. "Check the service address". */
  errorAction?: TaskStatusAction;
  /** The data attribute carrying the status kind; manga keeps its old name. */
  statusAttribute?: string;
  delayMs?: number;
  noticeTimeoutMs?: number;
  elapsedThresholdSeconds?: number;
}

const formatElapsed = (status: { startedAt: number }, now: number): number =>
  Math.max(0, Math.floor((now - status.startedAt) / 1000));

/**
 * Feedback docked at the bottom centre of the reading area, just above the
 * footer bar. It is owned by the reader pane (not the global toast slot) so a
 * progress bar, a notice and an error can't displace each other; a fixed box
 * outside the paged snapshot also stays out of page turns.
 */
const TaskStatusBar: React.FC<TaskStatusBarProps> = ({
  status,
  onStop,
  onRetry,
  onDismiss,
  errorAction,
  statusAttribute = 'data-task-status',
  delayMs = TASK_STATUS_DELAY_MS,
  noticeTimeoutMs = TASK_NOTICE_TIMEOUT_MS,
  elapsedThresholdSeconds = TASK_ELAPSED_THRESHOLD_SECONDS,
}) => {
  const _ = useTranslation();
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const kind = status?.kind ?? null;
  const startedAt = status?.kind === 'progress' ? status.startedAt : 0;

  useEffect(() => {
    if (!kind) {
      setVisible(false);
      return;
    }

    if (kind === 'progress') {
      setVisible(false);
      setNow(Date.now());
      const showTimer = setTimeout(() => {
        setVisible(true);
        setNow(Date.now());
      }, delayMs);
      return () => clearTimeout(showTimer);
    }

    setVisible(true);
    setNow(Date.now());
    if (kind === 'notice') {
      const hideTimer = setTimeout(() => {
        setVisible(false);
        dismissRef.current?.();
      }, noticeTimeoutMs);
      return () => clearTimeout(hideTimer);
    }
    return undefined;
  }, [kind, startedAt, delayMs, noticeTimeoutMs]);

  const elapsed = status?.kind === 'progress' ? formatElapsed(status, now) : 0;
  const showElapsed = status?.kind === 'progress' && elapsed >= elapsedThresholdSeconds;

  useEffect(() => {
    if (status?.kind !== 'progress') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status?.kind, startedAt]);

  if (!status || !visible) return null;

  const isError = status.kind === 'error';
  const message =
    status.kind === 'progress'
      ? showElapsed
        ? status.message + ` · ${elapsed} ` + _('秒')
        : status.message
      : status.message;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      {...{ [statusAttribute]: status.kind }}
      className='pointer-events-auto absolute left-1/2 z-[9] flex h-9 -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-body'
      style={{
        bottom: '56px',
        backgroundColor: 'color-mix(in srgb, var(--color-base-100) 92%, transparent)',
        border: '1px solid var(--color-base-300)',
        boxShadow: '0 8px 24px rgba(0,0,0,.12)',
      }}
    >
      <span className='text-base-content'>{message}</span>
      {status.kind === 'error' && status.detail && (
        <span className='text-base-content/60 shrink-0 text-xs'>{status.detail}</span>
      )}
      {status.kind === 'progress' && onStop && (
        <button className='link link-hover shrink-0 text-sm font-medium' onClick={onStop}>
          {_('停止')}
        </button>
      )}
      {isError && (
        <span className='flex shrink-0 items-center gap-2'>
          {onRetry && (
            <button className='link link-hover text-sm font-medium' onClick={onRetry}>
              {_('重试')}
            </button>
          )}
          {errorAction && (
            <button className='link link-hover text-sm font-medium' onClick={errorAction.onClick}>
              {errorAction.label}
            </button>
          )}
          {onDismiss && (
            <button className='link link-hover text-base-content/60 text-sm' onClick={onDismiss}>
              {_('关闭')}
            </button>
          )}
        </span>
      )}
    </div>
  );
};

export default TaskStatusBar;
