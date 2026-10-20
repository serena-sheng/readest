import '../../setupMemoryStorage';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MangaCoachMark, {
  MANGA_COACH_AUTO_DISMISS_MS,
  MANGA_COACH_MESSAGE,
  MANGA_COACH_SEEN_KEY,
} from '@/app/reader/components/manga/MangaCoachMark';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

const makeTrigger = (): HTMLButtonElement => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.getBoundingClientRect = () => rect(200, 10, 32, 32);
  return trigger;
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.querySelectorAll('button').forEach((node) => node.remove());
});

describe('MangaCoachMark', () => {
  it('shows the one-time hint with both actions on first use', () => {
    const trigger = makeTrigger();
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={vi.fn()} />,
    );

    expect(screen.getByText(MANGA_COACH_MESSAGE)).toBeTruthy();
    expect(screen.getByText('翻译这一页')).toBeTruthy();
    expect(screen.getByText('先不用')).toBeTruthy();
    expect(window.localStorage.getItem(MANGA_COACH_SEEN_KEY)).toBeNull();
  });

  it('stays hidden once the user has seen it', () => {
    window.localStorage.setItem(MANGA_COACH_SEEN_KEY, '1');
    const trigger = makeTrigger();
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={vi.fn()} />,
    );

    expect(screen.queryByText(MANGA_COACH_MESSAGE)).toBeNull();
  });

  it('records the seen flag, closes, and reports dismissal on 先不用', () => {
    const onDismiss = vi.fn();
    const trigger = makeTrigger();
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={vi.fn()} onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getByText('先不用'));

    expect(window.localStorage.getItem(MANGA_COACH_SEEN_KEY)).toBe('1');
    expect(screen.queryByText(MANGA_COACH_MESSAGE)).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('starts translation from 翻译这一页 and still records the seen flag', () => {
    const onTranslate = vi.fn();
    const trigger = makeTrigger();
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={onTranslate} />,
    );

    fireEvent.click(screen.getByText('翻译这一页'));

    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(MANGA_COACH_SEEN_KEY)).toBe('1');
    expect(screen.queryByText(MANGA_COACH_MESSAGE)).toBeNull();
  });

  it('dismisses itself after six seconds', () => {
    vi.useFakeTimers();
    const trigger = makeTrigger();
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={vi.fn()} />,
    );
    expect(screen.getByText(MANGA_COACH_MESSAGE)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MANGA_COACH_AUTO_DISMISS_MS);
    });

    expect(screen.queryByText(MANGA_COACH_MESSAGE)).toBeNull();
    expect(window.localStorage.getItem(MANGA_COACH_SEEN_KEY)).toBe('1');
  });

  it('dismisses on an outside pointer press but not on a press inside the panel', () => {
    const trigger = makeTrigger();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    render(
      <MangaCoachMark triggerRef={{ current: trigger }} onTranslate={vi.fn()} />,
    );

    const panel = screen.getByText(MANGA_COACH_MESSAGE).closest('[role="dialog"]')!;
    fireEvent.pointerDown(panel);
    expect(screen.getByText(MANGA_COACH_MESSAGE)).toBeTruthy();

    fireEvent.pointerDown(outside);
    expect(screen.queryByText(MANGA_COACH_MESSAGE)).toBeNull();
    expect(window.localStorage.getItem(MANGA_COACH_SEEN_KEY)).toBe('1');
  });
});
