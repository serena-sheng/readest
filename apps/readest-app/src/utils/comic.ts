import type { BookFormat, ViewSettings } from '@/types/book';

/**
 * Readest treats a comic as a CBZ document: `DocumentLoader` reports
 * `format: 'CBZ'` for it and `book.format === 'CBZ'` for the library record.
 * PDFs are fixed-layout too but are not comics.
 */
export const isComicFormat = (format?: BookFormat | null): boolean => format === 'CBZ';

/**
 * The view settings a comic gets on its first open, before the reader has any
 * per-book override of its own:
 *
 * - single page (`spreadMode: 'none'` — what the View menu's Single Page
 *   button writes for a fixed-layout book; `maxColumnCount: 1` keeps the
 *   reflowable column count consistent if the same document ever takes the
 *   paginator path)
 * - fit page (`zoomMode: 'fit-page'`, the fixed-layout default the View menu's
 *   Fit Page button writes)
 * - paginated (webtoon off, scrolled off) so a landscape/split spread cannot
 *   leave a single page half-width
 * - reading direction from the book's own `dir`; a CBZ without one is LTR
 *   rather than forced RTL — manga with a right-to-left page progression
 *   declares it in the document or the user picks it in the panel.
 */
export const getComicViewDefaults = (docDir?: string | null): Partial<ViewSettings> => ({
  spreadMode: 'none',
  zoomMode: 'fit-page',
  webtoonMode: false,
  scrolled: false,
  maxColumnCount: 1,
  writingMode: docDir === 'rtl' ? 'horizontal-rl' : 'horizontal-tb',
});

const isSameSettingValue = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether `viewSettings` holds anything the user changed for this book.
 *
 * `loadBookConfig` merges the global view settings (plus the fixed-layout
 * defaults) into every loaded config, and `serializeConfig` drops a per-book
 * value whenever it equals that same baseline. So any key whose value differs
 * from the baseline was persisted as a per-book override — including values
 * written by this reader's own panels. Refusing to touch such a book keeps
 * first-open defaults from overriding a reader who already tuned it.
 */
export const hasViewSettingOverrides = (
  viewSettings: Partial<ViewSettings>,
  baseline: Partial<ViewSettings>,
): boolean =>
  Object.keys(viewSettings).some(
    (key) =>
      !isSameSettingValue(
        viewSettings[key as keyof ViewSettings],
        baseline[key as keyof ViewSettings],
      ),
  );
