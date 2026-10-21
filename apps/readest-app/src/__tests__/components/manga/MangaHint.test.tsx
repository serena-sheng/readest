import '../../setupMemoryStorage';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MangaHint, {
  MANGA_HINT_MESSAGE,
  MANGA_HINT_SEEN_KEY,
  markMangaHintSeen,
} from '@/app/reader/components/manga/MangaHint';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe('MangaHint', () => {
  it('appears on the first manga page and explains the three display states', () => {
    render(<MangaHint />);

    expect(screen.getByText(MANGA_HINT_MESSAGE)).toBeTruthy();
    expect(screen.getByText('知道了')).toBeTruthy();
    expect(screen.getByText('不再提示')).toBeTruthy();
    expect(window.localStorage.getItem(MANGA_HINT_SEEN_KEY)).toBeNull();
  });

  it('writes emm.manga.hintSeen and closes on 不再提示', () => {
    const onDismiss = vi.fn();
    render(<MangaHint onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('不再提示'));

    expect(window.localStorage.getItem(MANGA_HINT_SEEN_KEY)).toBe('1');
    expect(screen.queryByText(MANGA_HINT_MESSAGE)).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays hidden once the reader has dismissed it permanently', () => {
    markMangaHintSeen();
    render(<MangaHint />);

    expect(window.localStorage.getItem(MANGA_HINT_SEEN_KEY)).toBe('1');
    expect(screen.queryByText(MANGA_HINT_MESSAGE)).toBeNull();
  });

  it('closes on 知道了 without writing the permanent flag', () => {
    const onDismiss = vi.fn();
    render(<MangaHint onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('知道了'));

    expect(screen.queryByText(MANGA_HINT_MESSAGE)).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(MANGA_HINT_SEEN_KEY)).toBeNull();
  });
});
