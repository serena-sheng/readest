/**
 * Chooses which paragraphs a translation pass should cover.
 *
 * Translation is driven by the viewport, so the work is bounded by what the
 * reader can actually see plus a fixed read-ahead budget. Two rules matter:
 *
 * - The visible paragraphs are always selected, however much text they hold.
 * - Read-ahead starts *after* the last visible paragraph and never reaches
 *   backwards. Scrolling downwards must not re-translate the previous page,
 *   and turning back must not silently spend tokens on text already passed.
 *
 * Billing is per character, so the budget is expressed in characters: one
 * "screen" is the number of characters currently visible, with a floor for
 * viewports whose visible text is unusually short (headings, image pages).
 */

export const TRANSLATION_LOOKAHEAD_SCREENS = 5;

/**
 * A viewport that shows fewer characters than this is not representative of
 * the book's density, so the budget uses this floor instead.
 */
export const MIN_TRANSLATION_SCREEN_CHARS = 800;

export function estimateScreenChars(visibleChars: number): number {
  if (!Number.isFinite(visibleChars) || visibleChars <= 0) {
    return MIN_TRANSLATION_SCREEN_CHARS;
  }
  return Math.max(MIN_TRANSLATION_SCREEN_CHARS, Math.round(visibleChars));
}

export interface SelectNodesForTranslationArgs {
  /** Nodes in document order. */
  nodes: HTMLElement[];
  /** Indexes of currently visible nodes, ascending or not. */
  visibleIndexes: number[];
  /** Indexes that already hold a translation or a cache hit. */
  translated: Set<number>;
  /** Characters visible in one screen. */
  screenChars: number;
  /** Total screens to cover, visible screen included. Defaults to 5. */
  maxScreens?: number;
  /** Character count of a node, used for the screen budget. */
  charOf: (el: HTMLElement) => number;
}

export interface TranslationNodeSelection {
  visible: number[];
  lookahead: number[];
  skipped: number[];
  /** Screens consumed by the selection; visible text counts as screen 1. */
  usedScreens: number;
}

/**
 * Selects the visible nodes and up to `maxScreens - 1` screens of read-ahead.
 *
 * `translated` nodes are skipped and do not consume budget: a cached or
 * already rendered paragraph costs nothing. A single read-ahead node that is
 * larger than the remaining budget is still included once — otherwise one
 * long paragraph would stall read-ahead completely — and the overshoot shows
 * up in `usedScreens`. Indexes before the first visible node are never
 * returned because they are never examined.
 */
export function selectNodesForTranslation({
  nodes,
  visibleIndexes,
  translated,
  screenChars,
  maxScreens = TRANSLATION_LOOKAHEAD_SCREENS,
  charOf,
}: SelectNodesForTranslationArgs): TranslationNodeSelection {
  const uniqueVisible = Array.from(new Set(visibleIndexes))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < nodes.length)
    .sort((a, b) => a - b);

  if (nodes.length === 0 || uniqueVisible.length === 0) {
    return { visible: [], lookahead: [], skipped: [], usedScreens: 0 };
  }

  const screen = screenChars > 0 ? screenChars : MIN_TRANSLATION_SCREEN_CHARS;
  const screens = Math.max(1, Math.floor(maxScreens));
  const lookaheadBudget = (screens - 1) * screen;
  const lastVisible = uniqueVisible[uniqueVisible.length - 1]!;

  const visible: number[] = [];
  const lookahead: number[] = [];
  const skipped: number[] = [];

  let visibleChars = 0;
  for (const index of uniqueVisible) {
    if (translated.has(index)) {
      skipped.push(index);
      continue;
    }
    visible.push(index);
    visibleChars += Math.max(0, charOf(nodes[index]!));
  }

  let lookaheadChars = 0;
  let budgetExhausted = lookaheadBudget <= 0;
  for (let index = lastVisible + 1; index < nodes.length; index++) {
    if (translated.has(index)) {
      skipped.push(index);
      continue;
    }
    if (budgetExhausted) {
      skipped.push(index);
      continue;
    }

    const chars = Math.max(0, charOf(nodes[index]!));
    if (lookaheadChars + chars > lookaheadBudget && lookahead.length > 0) {
      skipped.push(index);
      budgetExhausted = true;
      continue;
    }

    lookahead.push(index);
    lookaheadChars += chars;
    if (lookaheadChars >= lookaheadBudget) {
      budgetExhausted = true;
    }
  }

  // Look-ahead starts at `lastVisible + 1`, so no returned index is below the
  // first visible index: the selection never reaches backwards.
  const rawScreens = (visibleChars + lookaheadChars) / screen;
  return {
    visible,
    lookahead,
    skipped: skipped.sort((a, b) => a - b),
    usedScreens: visible.length > 0 ? Math.max(1, rawScreens) : rawScreens,
  };
}
