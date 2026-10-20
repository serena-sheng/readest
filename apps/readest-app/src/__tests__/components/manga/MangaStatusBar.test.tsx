import '../../setupMemoryStorage';

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MangaStatusBar from '@/app/reader/components/manga/MangaStatusBar';
import {
  MANGA_EMPTY_STATUS_TIMEOUT_MS,
  MANGA_STATUS_DELAY_MS,
} from '@/app/reader/components/manga/MangaStatusBar';

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

describe('MangaStatusBar', () => {
  it('appears only after the cache-miss delay when translating', () => {
    render(
      <MangaStatusBar status={{ kind: 'translating', startedAt: Date.now() }} onStop={vi.fn()} />,
    );

    expect(screen.queryByText('正在翻译这一页…')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(MANGA_STATUS_DELAY_MS - 1);
    });
    expect(screen.queryByText('正在翻译这一页…')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('正在翻译这一页…')).toBeTruthy();
  });

  it('docks above the footer instead of over the top bar', () => {
    render(<MangaStatusBar status={{ kind: 'empty' }} />);

    const status = screen.getByRole('status');
    // Anchored inside the reader cell, not to the window: the global viewport
    // centre would drift once the sidebar opens.
    expect(status.className).toContain('absolute');
    expect(status.className).not.toContain('fixed');
    expect(status.style.bottom).toBe('56px');
  });

  it('stops the request from the progress bar', () => {
    const onStop = vi.fn();
    render(
      <MangaStatusBar status={{ kind: 'translating', startedAt: Date.now() }} onStop={onStop} />,
    );

    act(() => {
      vi.advanceTimersByTime(MANGA_STATUS_DELAY_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('appends elapsed seconds after eight seconds', () => {
    render(
      <MangaStatusBar status={{ kind: 'translating', startedAt: Date.now() }} onStop={vi.fn()} />,
    );

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByText(/正在翻译这一页… · 8 秒/)).toBeTruthy();
  });

  it('dismisses the empty notice after 2.5 seconds', () => {
    const onDismiss = vi.fn();
    render(<MangaStatusBar status={{ kind: 'empty' }} onDismiss={onDismiss} />);

    expect(screen.getByText('本页没有文字')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MANGA_EMPTY_STATUS_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText('本页没有文字')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('本页没有文字')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a failure visible and offers retry and dismiss', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MangaStatusBar
        status={{ kind: 'error', message: '连不上翻译服务（http://127.0.0.1:8790）' }}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('连不上翻译服务（http://127.0.0.1:8790）');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
