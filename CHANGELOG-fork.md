# Readest fork — changelog

This fork is maintained locally; every entry below corresponds to commits on
`fork-main` in `serena-sheng/readest`.

## 0.13.2 — 2026-10-22

The design pass ("the quiet study") plus the reading tooling that motivated it.

### Library
- The library lands on **书房**: the book on the desk with its progress, a
  seven-row next-up queue, a 96px shelf, and the cover grid as a second view.
- Search from the home view carries its query into the grid (⌘K).
- Empty state is one sentence and a 40px outlined import button.
- Cover badges, 8/10px type and colour noise are gone; titles are 13/19 and the
  meta line carries `已读 · 100%`.

### Reader
- Chrome disappears by default: a hover-only row aligned to the text measure, a
  single 2px progress hairline at the window edge, and a contents-page sidebar
  (chapter · dotted leader · page, 2px marker on the current row).
- Every tool that used to be a header icon now lives in 更多 (translation,
  manga, bookmark, quick action, window controls) — nothing was removed.
- Annotation translation, dictionary lookups and notes land in a **margin rail**
  outside the text with dotted leaders, 3-line clamp and a stable per-book key;
  it narrows to 120px on a 13" display and becomes one dot per paragraph under
  1200px. Nothing ever reflows the page.

### Manga
- The single cycling button is replaced by three independent controls on a
  page-level cluster: 翻译本页, a 覆盖 / 两侧 / 原文 segment, and 更多. Under
  640px it collapses to one round button whose sheet grows leftwards.
- Translated pills are paper-coloured marginalia in the serif face; painted
  bubbles get an 11px floor at 1.4 leading; both fade in over 120ms with opacity
  only.
- Opening an archive converts it to a fixed-layout EPUB in archive order, uses
  the first page as the cover, and reads the cover once through the vision
  endpoint to fill title, artist, circle, parody, language and tags before the
  EPUB is built.
- Import failures fall back to the original file; the archive is never moved.

### Reading data
- iCloud is the only library root: `Readest/Books` on iCloud Drive, with the
  local `Books` folder turned into a symlink after a transactional migration.
- Series volumes are parsed before titles are cleaned and shown as `第 N 卷`;
  titles that collapse to the same text get a display-only `（2）` suffix.

### Titles and discovery
- **建议书名**: one suggestion per book (translate, strip author/circle/group/
  language markers/volume noise, keep ≤24 characters), reviewed in a table where
  every row can be edited, checked or skipped before applying.
- **扫描添加**: a Rust directory walk (depth 6, system caches skipped) plus a
  scoring pass that flags new books, new volumes of a known series, duplicates
  and files too small to be a book.

### TTS
- Doubao (Volcano) speech with six audiobook voices, credentials in settings.
- Playback speed 0.5×–4×; tone-only voices are hidden in the local build.

### Tooling
- `/preview` (dev-only) renders the library home, reader chrome, margin rail and
  manga cluster against fixtures, and `shot.mjs` drives headless Chrome over CDP
  so design rounds never need the user's window.

## 0.13.0 — 2026-10-21

- Manga translation ported from the author's Transelle extension (vision model →
  bubble boxes → in-bubble typesetting or side-column layout, per-page cache,
  one-page prefetch, persisted mode).
- Translation viewport budget (visible + ≤5 screens, never backwards), IndexedDB
  cache, local glossary for OpenAI-compatible endpoints, DeepSeek multimodal for
  manga pages.
