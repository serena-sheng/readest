import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { add, clear, type MarginNote } from '@/services/marginalia/store';
import MarginRail from '@/app/reader/components/marginalia/MarginRail';
import { MARGIN_NOTE_HEIGHT } from '@/app/reader/components/marginalia/MarginNoteItem';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/store/readerStore', () => {
  const state = { viewStates: {} };
  const useReaderStore = (selector?: (value: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useReaderStore.getState = () => ({ getView: () => null });
  return { useReaderStore };
});

const BOOK = 'book-rail';

const note = (overrides: Partial<MarginNote> = {}): MarginNote => ({
  id: 'note-1',
  anchorCfi: 'epubcfi(/6/2!/4/2/1:0)',
  kind: 'translation',
  text: '你好',
  at: 1,
  ...overrides,
});

const PAGE = { left: 100, right: 900, top: 40, bottom: 840 };

const renderRail = (
  props: Partial<ComponentProps<typeof MarginRail>> = {},
  tops: Record<string, number> = {},
) =>
  render(
    <MarginRail
      bookKey={BOOK}
      narrow={false}
      measurePage={() => PAGE}
      measureAnchor={(cfi) => tops[cfi] ?? null}
      {...props}
    />,
  );

beforeEach(() => {
  clear(BOOK);
  Object.defineProperty(window, 'innerWidth', {
    value: 1400,
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe('MarginRail', () => {
  it('renders one item per margin note', () => {
    add(BOOK, note({ id: 'a' }));
    add(BOOK, note({ id: 'b', anchorCfi: 'cfi-b', at: 2 }));
    add(BOOK, note({ id: 'c', anchorCfi: 'cfi-c', at: 3 }));

    renderRail({}, { 'epubcfi(/6/2!/4/2/1:0)': 60, 'cfi-b': 200, 'cfi-c': 400 });

    expect(screen.getAllByTestId('margin-note')).toHaveLength(3);
  });

  it('draws exactly one leader per note', () => {
    add(BOOK, note({ id: 'a' }));
    add(BOOK, note({ id: 'b', anchorCfi: 'cfi-b', at: 2 }));

    renderRail({}, { 'epubcfi(/6/2!/4/2/1:0)': 60, 'cfi-b': 260 });

    expect(screen.getAllByTestId('margin-note-leader')).toHaveLength(2);
  });

  it('stacks notes that share a paragraph without overlapping', () => {
    add(BOOK, note({ id: 'a', kind: 'note', at: 1 }));
    add(BOOK, note({ id: 'b', kind: 'note', at: 2 }));

    renderRail({}, { 'epubcfi(/6/2!/4/2/1:0)': 100 });

    const tops = screen
      .getAllByTestId('margin-note-anchor')
      .map((element) => Number(element.dataset['top']));
    expect(tops).toEqual([100, 100 + MARGIN_NOTE_HEIGHT]);
  });

  it('pushes a conflicting note down by 8px from the previous one', () => {
    add(BOOK, note({ id: 'a', anchorCfi: 'cfi-a' }));
    add(BOOK, note({ id: 'b', anchorCfi: 'cfi-b', at: 2 }));

    renderRail({}, { 'cfi-a': 100, 'cfi-b': 120 });

    const tops = screen
      .getAllByTestId('margin-note-anchor')
      .map((element) => Number(element.dataset['top']));
    expect(tops[1]).toBe(100 + MARGIN_NOTE_HEIGHT + 8);
  });

  it('collapses to one badge per anchored paragraph on a narrow viewport', () => {
    add(BOOK, note({ id: 'a' }));
    add(BOOK, note({ id: 'b', at: 2 }));
    add(BOOK, note({ id: 'c', anchorCfi: 'cfi-c', at: 3 }));

    renderRail({ narrow: true }, { 'epubcfi(/6/2!/4/2/1:0)': 100, 'cfi-c': 200 });

    expect(screen.getByTestId('margin-rail').dataset['mode']).toBe('badges');
    expect(screen.getAllByTestId('margin-badge')).toHaveLength(2);
    expect(screen.queryByTestId('margin-note')).toBeNull();
  });

  it('opens the paragraph notes from a badge', () => {
    add(BOOK, note({ id: 'a' }));
    add(BOOK, note({ id: 'b', kind: 'note', text: '自己的想法', at: 2 }));

    renderRail({ narrow: true }, { 'epubcfi(/6/2!/4/2/1:0)': 100 });

    expect(screen.queryByTestId('margin-badge-popup')).toBeNull();
    fireEvent.click(screen.getByTestId('margin-badge'));
    expect(screen.getByTestId('margin-badge-popup')).toBeTruthy();
    expect(screen.getAllByTestId('margin-note')).toHaveLength(2);
  });

  it('expands a note into a floating panel and closes it with Escape', () => {
    add(BOOK, note({ id: 'a', text: '一段很长的译文' }));

    renderRail({}, { 'epubcfi(/6/2!/4/2/1:0)': 60 });

    expect(screen.queryByTestId('margin-note-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('margin-note-text'));
    const panel = screen.getByTestId('margin-note-panel');
    expect(panel.textContent).toContain('一段很长的译文');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('margin-note-panel')).toBeNull();
  });

  it('removes a note when Delete is pressed', () => {
    add(BOOK, note({ id: 'a' }));
    add(BOOK, note({ id: 'b', anchorCfi: 'cfi-b', at: 2 }));

    renderRail({}, { 'epubcfi(/6/2!/4/2/1:0)': 60, 'cfi-b': 260 });
    fireEvent.click(screen.getAllByTestId('margin-note-text')[0]!);

    act(() => {
      fireEvent.click(screen.getByTestId('margin-note-delete'));
    });

    expect(screen.getAllByTestId('margin-note')).toHaveLength(1);
    expect(screen.queryByTestId('margin-note-panel')).toBeNull();
  });
});
