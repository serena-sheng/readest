import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskStatusBar, {
  TASK_NOTICE_TIMEOUT_MS,
  TASK_STATUS_DELAY_MS,
} from '@/app/reader/components/TaskStatusBar';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskStatusBar', () => {
  it('renders any progress message after the cache-miss delay', () => {
    render(
      <TaskStatusBar
        status={{ kind: 'progress', message: '正在翻译 3/12', startedAt: Date.now() }}
      />,
    );

    expect(screen.queryByText('正在翻译 3/12')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(TASK_STATUS_DELAY_MS);
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('正在翻译 3/12');
    // Anchored inside the reader cell, not to the window.
    expect(status.className).toContain('absolute');
    expect(status.className).not.toContain('fixed');
    expect(status.style.bottom).toBe('56px');
  });

  it('keeps an error visible and exposes it as an alert', () => {
    render(<TaskStatusBar status={{ kind: 'error', message: '这 2 段没翻成' }} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-task-status')).toBe('error');
    expect(alert.textContent).toContain('这 2 段没翻成');
  });

  it('invokes retry and the error action from a failure', () => {
    const onRetry = vi.fn();
    const onCheckService = vi.fn();
    render(
      <TaskStatusBar
        status={{ kind: 'error', message: '这 1 段没翻成' }}
        onRetry={onRetry}
        errorAction={{ label: '检查服务地址', onClick: onCheckService }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '检查服务地址' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCheckService).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses a notice and reports it', () => {
    const onDismiss = vi.fn();
    render(
      <TaskStatusBar status={{ kind: 'notice', message: '本页没有文字' }} onDismiss={onDismiss} />,
    );

    expect(screen.getByText('本页没有文字')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(TASK_NOTICE_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText('本页没有文字')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('本页没有文字')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears the failure when the status resets', () => {
    const { rerender } = render(
      <TaskStatusBar status={{ kind: 'error', message: '这 2 段没翻成' }} />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(<TaskStatusBar status={null} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing without a status', () => {
    const { container } = render(<TaskStatusBar status={null} />);
    expect(container.firstChild).toBeNull();
  });
});
