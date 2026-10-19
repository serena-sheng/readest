import { describe, expect, test } from 'vitest';

import {
  estimateScreenChars,
  MIN_TRANSLATION_SCREEN_CHARS,
  selectNodesForTranslation,
  TRANSLATION_LOOKAHEAD_SCREENS,
} from '@/services/translators/viewportBudget';

const makeNodes = (sizes: number[]) =>
  sizes.map(
    (size) =>
      ({
        textContent: 'x'.repeat(size),
      }) as unknown as HTMLElement,
  );

const charOf = (el: HTMLElement) => el.textContent?.length ?? 0;

const select = (sizes: number[], visibleIndexes: number[], extra: Record<string, unknown> = {}) =>
  selectNodesForTranslation({
    nodes: makeNodes(sizes),
    visibleIndexes,
    translated: new Set<number>(),
    screenChars: 100,
    charOf,
    ...extra,
  });

describe('selectNodesForTranslation', () => {
  test('does not read ahead when the visible node is the last node', () => {
    const selection = select([100, 100], [1]);

    expect(selection.visible).toEqual([1]);
    expect(selection.lookahead).toEqual([]);
    expect(selection.skipped).toEqual([]);
  });

  test('stops exactly at the look-ahead budget boundary', () => {
    const selection = select([100, 100, 100, 100, 100, 100, 100], [0]);

    // 4 screens of read-ahead at 100 chars each.
    expect(selection.visible).toEqual([0]);
    expect(selection.lookahead).toEqual([1, 2, 3, 4]);
    expect(selection.skipped).toEqual([5, 6]);
    expect(selection.usedScreens).toBeCloseTo(TRANSLATION_LOOKAHEAD_SCREENS, 5);
  });

  test('never reaches before the first visible node', () => {
    const selection = select([100, 100, 100, 100, 100, 100, 100], [3, 4]);
    const returned = [...selection.visible, ...selection.lookahead, ...selection.skipped];

    expect(returned.every((index) => index >= 3)).toBe(true);
    expect(selection.visible).toEqual([3, 4]);
    expect(selection.lookahead).toEqual([5, 6]);
  });

  test('skips already translated nodes without spending budget', () => {
    const translated = new Set([1, 2]);
    const selection = select([100, 100, 100, 100, 100, 100, 100], [0, 1], { translated });

    // 1 is visible but translated; 2 is translated read-ahead. Neither costs
    // characters, so the budget still fits indexes 3..6.
    expect(selection.visible).toEqual([0]);
    expect(selection.lookahead).toEqual([3, 4, 5, 6]);
    expect(selection.skipped).toEqual([1, 2]);
    expect(selection.usedScreens).toBeCloseTo(TRANSLATION_LOOKAHEAD_SCREENS, 5);
  });

  test('allows one oversized node past the budget and reports the overshoot', () => {
    const selection = select([100, 500, 100, 100], [0]);

    expect(selection.visible).toEqual([0]);
    expect(selection.lookahead).toEqual([1]);
    expect(selection.skipped).toEqual([2, 3]);
    expect(selection.usedScreens).toBeCloseTo(6, 5);
  });

  test('returns an empty selection when nothing is visible', () => {
    expect(select([100, 100], [])).toEqual({
      visible: [],
      lookahead: [],
      skipped: [],
      usedScreens: 0,
    });
    expect(select([100, 100], [99])).toEqual({
      visible: [],
      lookahead: [],
      skipped: [],
      usedScreens: 0,
    });
  });

  test('honours the maxScreens argument', () => {
    const selection = select([100, 100, 100, 100], [0], { maxScreens: 2 });

    expect(selection.lookahead).toEqual([1]);
    expect(selection.skipped).toEqual([2, 3]);
    expect(selection.usedScreens).toBeCloseTo(2, 5);
  });

  test('keeps visible nodes even when they exceed the screen budget', () => {
    const selection = select([1000, 100], [0], { maxScreens: 3 });

    expect(selection.visible).toEqual([0]);
    // Visible text already consumes 10 screens, so read-ahead gets nothing
    // beyond one node.
    expect(selection.usedScreens).toBeGreaterThanOrEqual(10);
  });

  test('estimateScreenChars applies the 800 character floor', () => {
    expect(MIN_TRANSLATION_SCREEN_CHARS).toBe(800);
    expect(estimateScreenChars(0)).toBe(800);
    expect(estimateScreenChars(Number.NaN)).toBe(800);
    expect(estimateScreenChars(1200.4)).toBe(1200);
  });
});
