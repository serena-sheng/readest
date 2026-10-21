/**
 * Discovery layer for "scan the disk and suggest books to import".
 *
 * `scanImportable` (Rust) walks directory metadata only; this module turns
 * those hits into ranked suggestions. The scoring is deliberately explainable:
 * every bonus/penalty has a one-line reason the dialog can show, so the user
 * can see *why* a file was suggested instead of trusting a black box.
 */

import { invoke } from '@tauri-apps/api/core';
import { md5 } from 'js-md5';

import type { Book } from '@/types/book';
import { isTauriAppPlatform } from '@/services/environment';
import { getBaseFilename, getFilename } from '@/utils/path';

export interface ScanHit {
  path: string;
  size: number;
  /** Unix milliseconds, `0` when unavailable. */
  modified: number;
  kind: string;
  /** True when the Rust walk stopped at its 5000-file cap. */
  truncated?: boolean;
}

export interface DiscoveryCandidate {
  path: string;
  sizeBytes: number;
  kind: string;
  title: string;
  reason: string;
  score: number;
  duplicateOf?: string;
  alreadyInLibrary: boolean;
}

export interface DiscoveryOptions {
  roots: string[];
  library: Book[];
  maxDepth?: number;
  signal?: AbortSignal;
  /**
   * Test seam and future alternate hasher. Must only sample the file head;
   * default reads up to {@link PARTIAL_HASH_MAX_BYTES} through plugin-fs.
   */
  hashFile?: (path: string, size: number) => Promise<string | null>;
}

/** A candidate needs at least this score to be ticked by default. */
export const SUGGEST_MIN_SCORE = 40;
export const SMART_FILE_BYTES = 200 * 1024;
export const LARGE_FILE_BYTES = 20 * 1024 * 1024;
export const PARTIAL_HASH_MAX_BYTES = 20 * 1024 * 1024;
const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const DUPLICATE_PENALTY = -30;
const TINY_FILE_PENALTY = -50;
const ALREADY_IN_LIBRARY_SCORE = -100;

const MB = 1024 * 1024;

/* ------------------------------------------------------------------------- *
 * Title parsing
 * ------------------------------------------------------------------------- */

/** Leading noise that scanlation/download dumps put in front of the title. */
const LEADING_NOISE = [
  /^\[[^\]]*\]\s*/, // [Group] / [DL版]
  /^\d{1,4}\s*[.)\-_]\s+/, // 01 - / 2. / 3_
  /^第?\s*\d{1,4}\s*[巻卷話话章集]\s*/, // 第3巻
  /^(?:vol(?:ume)?|v)\.?\s*\d{1,4}\s*[.\-_)]?\s*/i, // vol.3 / v03
];

/** Trailing volume markers used to recognise a series. */
const TRAILING_VOLUME = [
  /\s*(?:第\s*)?\d{1,4}\s*(?:巻|卷|話|话|章|集)\s*$/,
  /\s*(?:vol(?:ume)?|v)\.?\s*\d{1,4}\s*$/i,
  /\s*#\s*\d{1,4}\s*$/,
  /\s*[-–—]\s*\d{1,4}\s*$/,
  /\s*[(（]\s*\d{1,4}\s*[)）]\s*$/,
];

/**
 * Human title for a scanned file: extension off, separators normalised, and
 * the leading numbering/group tags that download tools add removed.
 */
export function parseCandidateTitle(fileName: string): string {
  const original = getFilename(fileName);
  let title = getBaseFilename(original)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_NOISE) {
      const next = title.replace(pattern, '').trim();
      if (next && next !== title) {
        title = next;
        changed = true;
      }
    }
  }
  return title || getBaseFilename(original) || original;
}

/** Comparison key: case/punctuation-insensitive title. */
function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_·・:：\-–—]+/g, '')
    .replace(/[【】[\]()（）「」『』]/g, '');
}

/** Series key: the title with a trailing volume marker removed. */
export function seriesKey(title: string): string {
  let key = title;
  for (const pattern of TRAILING_VOLUME) {
    key = key.replace(pattern, '');
  }
  return titleKey(key);
}

/** Filesystem path comparison key (macOS/Windows are case-insensitive). */
function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/* ------------------------------------------------------------------------- *
 * Partial hashing
 * ------------------------------------------------------------------------- */

/**
 * Reads the same sparse head/middle/tail samples as `partialMD5(File)` from a
 * path, so a scanned candidate can be compared with a library book's `hash`.
 * Files above {@link PARTIAL_HASH_MAX_BYTES} are skipped: stat-ing them is
 * cheap, but opening and seeking a multi-GB archive is not worth the benefit.
 * Returns `null` whenever the platform cannot read the file.
 */
export async function partialMD5FromPath(path: string, size: number): Promise<string | null> {
  if (!isTauriAppPlatform() || size > PARTIAL_HASH_MAX_BYTES || size <= 0) return null;
  try {
    // Static import is not an option: the web bundle has no plugin-fs runtime,
    // and importing it eagerly breaks the browser build (same rationale as
    // services/manga/import/fs.ts). The specifier is fixed.
    const { open, SeekMode } = await import('@tauri-apps/plugin-fs');
    const file = await open(path, { read: true });
    try {
      const hasher = md5.create();
      const step = 1024;
      const chunkSize = 1024;
      for (let i = -1; i <= 10; i++) {
        const start = Math.min(size, step << (2 * i));
        const end = Math.min(start + chunkSize, size);
        if (start >= size) break;
        await file.seek(start, SeekMode.Start);
        const buffer = new Uint8Array(end - start);
        const read = await file.read(buffer);
        if (read) hasher.update(buffer.subarray(0, read));
      }
      return hasher.hex();
    } finally {
      await file.close();
    }
  } catch (error) {
    console.warn('discovery: cannot hash', path, error);
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Library index
 * ------------------------------------------------------------------------- */

interface LibraryIndex {
  byPath: Map<string, Book>;
  byHash: Map<string, Book>;
  /** `${titleKey}|${format}` */
  byTitle: Map<string, Book>;
  /** Series key -> books in that series. */
  bySeries: Map<string, Book[]>;
}

export function buildDiscoveryIndex(library: Book[]): LibraryIndex {
  const byPath = new Map<string, Book>();
  const byHash = new Map<string, Book>();
  const byTitle = new Map<string, Book>();
  const bySeries = new Map<string, Book[]>();

  for (const book of library) {
    if (book.deletedAt) continue;
    if (book.hash) byHash.set(book.hash, book);
    for (const path of [book.filePath, ...(book.altFilePaths ?? [])]) {
      if (path) byPath.set(pathKey(path), book);
    }

    const title = book.title?.trim();
    if (!title) continue;
    const format = book.format?.toLowerCase() ?? '';
    byTitle.set(`${titleKey(title)}|${format}`, book);

    const key = seriesKey(title);
    if (key) {
      const bucket = bySeries.get(key);
      if (bucket) bucket.push(book);
      else bySeries.set(key, [book]);
    }
  }
  return { byPath, byHash, byTitle, bySeries };
}

/* ------------------------------------------------------------------------- *
 * Scoring
 * ------------------------------------------------------------------------- */

function isHundredDaysAgo(modified: number): boolean {
  if (!modified) return false;
  const age = Date.now() - modified;
  return age >= 0 && age <= RECENT_WINDOW_MS;
}

function tagDuplicate(index: LibraryIndex, title: string, kind: string): Book | undefined {
  return index.byTitle.get(`${titleKey(title)}|${kind}`);
}

function tagSeries(index: LibraryIndex, title: string): Book | undefined {
  const key = seriesKey(title);
  if (!key || key === titleKey(title)) return undefined;
  const books = index.bySeries.get(key);
  return books?.find((book) => !index.byTitle.has(`${titleKey(title)}|${book.format.toLowerCase()}`));
}

/**
 * Scores one hit. Kept separate from {@link discoverImportable} so the rules
 * stay readable and each one is directly testable.
 */
export function scoreHit(
  hit: ScanHit,
  index: LibraryIndex,
  hash: string | null,
): DiscoveryCandidate {
  const fileName = getFilename(hit.path);
  const title = parseCandidateTitle(fileName);
  const kind = hit.kind.toLowerCase();
  const sizeBytes = hit.size;

  const pathMatch = index.byPath.get(pathKey(hit.path));
  const hashMatch = hash ? index.byHash.get(hash) : undefined;
  const duplicate = tagDuplicate(index, title, kind);
  const seriesBook = duplicate ? undefined : tagSeries(index, title);

  // A path or byte-identical match is the book itself, not a suggestion.
  const alreadyInLibrary = Boolean(pathMatch || hashMatch);
  const duplicateOf = alreadyInLibrary
    ? (pathMatch ?? hashMatch)?.hash
    : duplicate
      ? duplicate.hash
      : undefined;

  let score = 0;
  let reason = '未在书库';

  if (alreadyInLibrary) {
    score = ALREADY_IN_LIBRARY_SCORE;
    reason = '已在书库';
  } else {
    if (duplicate) {
      score += DUPLICATE_PENALTY;
      reason = '与书库书名重复';
    } else {
      // Anything not already represented in the library earns the base bonus.
      score += 40;
      if (seriesBook) {
        score += 25;
        reason = '同系列新卷';
      }
    }
    if (isHundredDaysAgo(hit.modified)) score += 15;
    if (sizeBytes > LARGE_FILE_BYTES) score += 10;
    if (sizeBytes < SMART_FILE_BYTES) {
      score += TINY_FILE_PENALTY;
      if (reason === '未在书库') reason = '体积过小';
    }
  }

  return {
    path: hit.path,
    sizeBytes,
    kind,
    title,
    reason,
    score,
    duplicateOf,
    alreadyInLibrary,
  };
}

function compareCandidates(a: DiscoveryCandidate, b: DiscoveryCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/* ------------------------------------------------------------------------- *
 * Entry point
 * ------------------------------------------------------------------------- */

/**
 * Scans `roots`, ranks every book-shaped file, and returns the full ordered
 * list (already-in-library rows are kept, at the bottom, so the user can see
 * the scan actually found them). Returns `[]` on the web platform and when the
 * native scan fails — the caller shows an empty result rather than an error.
 */
export async function discoverImportable({
  roots,
  library,
  maxDepth,
  signal,
  hashFile = partialMD5FromPath,
}: DiscoveryOptions): Promise<DiscoveryCandidate[]> {
  if (!isTauriAppPlatform() || roots.length === 0) return [];
  if (signal?.aborted) return [];

  let hits: ScanHit[];
  try {
    hits = await invoke<ScanHit[]>('scan_importable', {
      roots,
      maxDepth: maxDepth ?? null,
    });
  } catch (error) {
    console.warn('discovery: scan_importable failed', error);
    return [];
  }
  if (!Array.isArray(hits) || signal?.aborted) return [];

  const index = buildDiscoveryIndex(library);
  const candidates: DiscoveryCandidate[] = [];

  for (const hit of hits) {
    if (signal?.aborted) return [];
    if (!hit?.path || typeof hit.size !== 'number') continue;

    let hash: string | null = null;
    // Hashing is only useful when the library knows a hash to compare against,
    // and never for a file the path hash already identifies.
    if (index.byHash.size > 0 && !index.byPath.has(pathKey(hit.path))) {
      hash = await hashFile(hit.path, hit.size).catch(() => null);
    }
    candidates.push(scoreHit(hit, index, hash));
  }

  candidates.sort(compareCandidates);
  return candidates;
}

/**
 * The rows the dialog ticks on open: genuinely new, well-sized files. A tiny
 * sample or a repeat of something already in the library is still shown, just
 * not selected.
 */
export function defaultSelected(candidate: DiscoveryCandidate): boolean {
  return (
    candidate.score >= SUGGEST_MIN_SCORE &&
    !candidate.alreadyInLibrary &&
    !candidate.duplicateOf &&
    candidate.sizeBytes >= SMART_FILE_BYTES
  );
}

/** Primary label shown on a row. */
export type CandidateTag = '建议' | '重复' | '已在书库' | '体积过小';

export function candidateTag(candidate: DiscoveryCandidate): CandidateTag {
  if (candidate.alreadyInLibrary) return '已在书库';
  if (candidate.duplicateOf) return '重复';
  if (candidate.sizeBytes < SMART_FILE_BYTES) return '体积过小';
  return '建议';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
