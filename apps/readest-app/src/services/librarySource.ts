import type { Book } from '@/types/book';

/**
 * Read-only bridge to the local CommonReader library service
 * (`commonreader-ai/server.py`). The service lists the books recorded in
 * `library.db` and streams each file; this module turns that list into Readest
 * imports.
 *
 * The bridge is intentionally one-way: Readest downloads a copy and imports it
 * through the normal file-import path. Nothing is written back to library.db.
 */

export const DEFAULT_LOCAL_LIBRARY_BASE_URL = 'http://127.0.0.1:8790';

export interface LocalLibraryBook {
  id: number;
  title: string;
  author: string;
  /** Absolute path on the machine running the service (not on this device). */
  path: string;
  page_count: number | null;
  source: string;
}

export interface LocalLibraryImportFailure {
  title: string;
  error: string;
}

export interface LocalLibraryImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failures: LocalLibraryImportFailure[];
  /** Titles (or `#id`) skipped because the library already had them. */
  skippedItems: string[];
}

export type LocalLibraryProgressPhase = 'list' | 'download' | 'import';

export interface LocalLibraryProgress {
  phase: LocalLibraryProgressPhase;
  index: number;
  total: number;
  title: string;
}

export interface LocalLibraryImportOptions {
  /** Current library rows, used for the title dedup. */
  books: Book[];
  /**
   * Imports one downloaded file and returns the resulting book (or null when
   * the importer deduped it away). Provided by the caller so this module stays
   * free of appService / settings / auth wiring and can be unit tested.
   */
  importFile: (file: File) => Promise<Book | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: LocalLibraryProgress) => void;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  cbz: 'application/vnd.comicbook+zip',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
};

/** Extensions the bridge knows how to name and type. */
const SUPPORTED_EXTENSIONS: Record<string, true> = { cbz: true, epub: true, pdf: true };

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Validate and normalize the `GET /library/books` payload. Entries without a
 * numeric id, a title, or a path are dropped rather than imported under a
 * placeholder name; a malformed response yields an empty list.
 */
export function parseLibraryBooks(payload: unknown): LocalLibraryBook[] {
  const raw = (payload as { books?: unknown } | null)?.books;
  if (!Array.isArray(raw)) return [];
  const books: LocalLibraryBook[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = asNumber(record['id']);
    const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
    const path = typeof record['path'] === 'string' ? record['path'] : '';
    if (id === null || !title || !path) continue;
    books.push({
      id,
      title,
      author: typeof record['author'] === 'string' ? record['author'] : '',
      path,
      page_count: asNumber(record['page_count']),
      source: typeof record['source'] === 'string' ? record['source'] : '',
    });
  }
  return books;
}

/**
 * Dedup key for "we already have this book". The service knows the remote
 * `source`/`source_id` but Readest has nowhere to persist it, so the stable
 * shared field is the title: trimmed, whitespace-collapsed, lowercased.
 * `importBook` still dedups by file hash afterwards, so a false negative here
 * costs a re-download, not a duplicate row.
 */
export function libraryBookKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function extensionOfPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Filesystem-safe download name, keeping the source extension. */
export function downloadFileName(title: string, path: string): string {
  const ext = extensionOfPath(path);
  const safeTitle = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const base = safeTitle || 'book';
  return ext ? `${base}.${ext}` : base;
}

export async function fetchLibraryBooks(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<LocalLibraryBook[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_LOCAL_LIBRARY_BASE_URL;
  const response = await fetcher(`${baseUrl}/library/books`);
  if (!response.ok) {
    throw new Error(`Library request failed (${response.status})`);
  }
  return parseLibraryBooks(await response.json());
}

export async function downloadLibraryBook(
  book: LocalLibraryBook,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<File> {
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_LOCAL_LIBRARY_BASE_URL;
  const response = await fetcher(`${baseUrl}/library/file?id=${encodeURIComponent(book.id)}`);
  if (!response.ok) {
    throw new Error(`Book download failed (${response.status})`);
  }
  const blob = await response.blob();
  const ext = extensionOfPath(book.path);
  const type = MIME_BY_EXTENSION[ext] ?? blob.type ?? 'application/octet-stream';
  return new File([blob], downloadFileName(book.title, book.path), { type });
}

/**
 * List the local library, download every book Readest does not already have,
 * and import each one. Per-book failures are collected and never abort the
 * run; the caller reports the final counts.
 */
export async function importFromLocalLibrary(
  options: LocalLibraryImportOptions,
): Promise<LocalLibraryImportResult> {
  const { books, importFile, onProgress } = options;
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_LOCAL_LIBRARY_BASE_URL;

  const remote = await fetchLibraryBooks({ baseUrl, fetchImpl: fetcher });

  const known = new Set(
    books.filter((book) => !book.deletedAt).map((book) => libraryBookKey(book.title)),
  );
  const result: LocalLibraryImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    skippedItems: [],
  };

  for (const [index, entry] of remote.entries()) {
    const label = entry.title || `#${entry.id}`;
    const ext = extensionOfPath(entry.path);
    if (!SUPPORTED_EXTENSIONS[ext]) {
      result.failed += 1;
      result.failures.push({ title: label, error: `Unsupported format: .${ext || '?'}` });
      continue;
    }
    const key = libraryBookKey(entry.title);
    if (known.has(key)) {
      result.skipped += 1;
      result.skippedItems.push(label);
      continue;
    }

    try {
      onProgress?.({ phase: 'download', index, total: remote.length, title: label });
      const file = await downloadLibraryBook(entry, { baseUrl, fetchImpl: fetcher });
      onProgress?.({ phase: 'import', index, total: remote.length, title: label });
      const book = await importFile(file);
      if (book) {
        result.imported += 1;
        // Guard against two remote entries with the same title in one run.
        known.add(key);
      } else {
        result.skipped += 1;
        result.skippedItems.push(label);
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        title: label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
