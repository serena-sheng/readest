import '../../setupMemoryStorage';

import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { add, clear, list, type MarginNote } from '@/services/marginalia/store';
import MarginRail, {
  LEAD_LENGTH,
  RAIL_WIDTH_COMPACT,
} from '@/app/reader/components/marginalia/MarginRail';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

const VIEWPORT_WIDTH = 1280;
/**
 * A paginator box: the visible page area, 700px wide at (200, 50). The rail is
 * derived from this, never from the window's `--reader-measure`.
 */
const renderer = {
  columnCount: 1,
  getContents: () => [],
  getBoundingClientRect: () => ({
    left: 200,
    right: 900,
    top: 50,
    bottom: 800,
    width: 700,
    height: 750,
  }),
};

vi.mock('@/store/readerStore', () => {
  const state = { viewStates: {} };
  const useReaderStore = (selector?: (value: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useReaderStore.getState = () => ({
    getView: () => ({ renderer, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  return { useReaderStore };
});

const BOOK = 'book-geometry';

const note = (overrides: Partial<MarginNote> = {}): MarginNote => ({
  id: 'note-1',
  anchorCfi: 'cfi-a',
  kind: 'translation',
  text: '你好',
  at: 1,
  ...overrides,
});

const renderRail = (props: Partial<ComponentProps<typeof MarginRail>> = {}) =>
  render(
    <MarginRail
      bookKey={BOOK}
      narrow={false}
      rtl={false}
      measureAnchor={(cfi) => (cfi === 'cfi-b' ? 260 : 60)}
      {...props}
    />,
  );

beforeEach(() => {
  clear(BOOK);
  Object.defineProperty(window, 'innerWidth', {
    value: VIEWPORT_WIDTH,
    configurable: true,
    writable: true,
  });
  renderer.columnCount = 1;
  renderer.getBoundingClientRect = () => ({
    left: 200,
    right: 900,
    top: 50,
    bottom: 800,
    width: 700,
    height: 750,
  });
  add(BOOK, note({ id: 'a' }));
  add(BOOK, note({ id: 'b', anchorCfi: 'cfi-b', at: 2 }));
});

afterEach(cleanup);

describe('MarginRail geometry', () => {
  it("sits just outside the visible page's outer edge, not the window measure", () => {
    renderRail();

    const rail = screen.getByTestId('margin-rail');
    expect(rail.dataset['mode']).toBe('rail');
    expect(rail.style.left).toBe(`${900 + LEAD_LENGTH}px`);
    expect(rail.style.top).toBe('50px');
    expect(rail.style.width).toBe(`${RAIL_WIDTH_COMPACT}px`);
    expect(rail.style.height).toBe('750px');
    // No `--reader-measure` arithmetic is left in the inline geometry.
    expect(rail.style.right).toBe('');
  });

  it('mirrors the gutter to the left edge for a right-to-left book', () => {
    renderRail({ rtl: true });

    const rail = screen.getByTestId('margin-rail');
    expect(rail.style.left).toBe(`${200 - LEAD_LENGTH - RAIL_WIDTH_COMPACT}px`);
  });

  it('degrades a two-page spread to window-edge dots instead of a gutter', () => {
    renderer.columnCount = 2;
    renderRail();

    const rail = screen.getByTestId('margin-rail');
    expect(rail.dataset['mode']).toBe('badges');
    expect(rail.style.right).toBe('4px');
    expect(rail.style.left).toBe('');
    expect(screen.getAllByTestId('margin-badge')).toHaveLength(2);
  });

  it('renders nothing when the page leaves no room and the rail would cross the text', () => {
    renderer.getBoundingClientRect = () => ({
      left: 200,
      right: 1260,
      top: 50,
      bottom: 800,
      width: 1060,
      height: 750,
    });
    renderRail();

    expect(screen.queryByTestId('margin-rail')).toBeNull();
  });

  it('leaves out notes whose anchors have not been measured', () => {
    renderRail({ measureAnchor: (cfi) => (cfi === 'cfi-a' ? 60 : null) });

    const anchors = screen.getAllByTestId('margin-note-anchor');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.dataset['top']).toBe('60');
  });

  it('reads a note back under a new per-session book key', () => {
    // The reader key carries a random suffix that changes every launch.
    clear(BOOK);
    add(`${BOOK}-abc1234`, note({ id: 'persisted' }));

    expect(list(`${BOOK}-xyz9876`).map((entry) => entry.id)).toEqual(['persisted']);
  });

  it('migrates notes from the old session-suffixed key', () => {
    clear(BOOK);
    const legacyKey = `readest-marginalia:${BOOK}-legacy1`;
    window.localStorage.setItem(legacyKey, JSON.stringify([note({ id: 'old' })]));

    expect(list(`${BOOK}-mig9876`).map((entry) => entry.id)).toEqual(['old']);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(window.localStorage.getItem(`readest-marginalia:${BOOK}`)).not.toBeNull();
  });
});
