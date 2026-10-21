/**
 * Shared types for the manga import pipeline (S1).
 *
 * The pipeline never touches `node:fs` directly: every file operation goes
 * through an injected {@link MangaFs}, so the same code runs under Tauri
 * (plugin-fs), in tests (in-memory), and in any future Node runner.
 */

/** One discovered import unit: a single archive or one directory. */
export interface ImportUnit {
  /** `archive` for `.cbz`/`.zip` files, `folder` for directories. */
  kind: 'archive' | 'folder';
  /** Absolute path to the archive file or directory. */
  path: string;
  /** Image pages found in the unit (ZIP central directory or folder listing). */
  images: number;
  /** Display title: the file name without extension, or the folder name. */
  title?: string;
}

/** An entry returned by {@link MangaFs.readDir}. */
export interface MangaDirEntry {
  name: string;
  /** Path of the entry (parent path joined with `name`). */
  path: string;
  isFile: boolean;
  isDirectory: boolean;
}

/** Metadata for a single path, as returned by {@link MangaFs.stat}. */
export interface MangaStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
}

/**
 * Minimal filesystem surface used by the import pipeline.
 *
 * `readFileSlice` exists so archive scanning can read only the ZIP central
 * directory instead of loading a multi-hundred-megabyte CBZ into memory.
 */
export interface MangaFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  readDir(path: string): Promise<MangaDirEntry[]>;
  stat(path: string): Promise<MangaStat>;
  /** Reads at most `length` bytes starting at `offset`; shorter at EOF. */
  readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array>;
}

/**
 * `metadata.json` schema 1 — the lossless source of truth for one work.
 *
 * `tags` keep their `namespace:value` form (`artist:wataya`) so filters can
 * distinguish namespaces; `ComicInfo.xml` carries the stripped form instead.
 * `manual` maps a field name to `true` when the user (or a site adapter) has
 * hand-edited it; merged imports never overwrite those fields.
 */
export interface MetadataFile {
  schema: 1;
  source?: string;
  gid?: number | string;
  aid?: string;
  token?: string;
  url?: string;
  title?: string;
  title_jpn?: string;
  category?: string;
  uploader?: string;
  posted?: string;
  rating?: number;
  pages?: number;
  language?: string[];
  tags?: string[];
  description?: string;
  /** `none` | `e-hentai:none` | `wnacg:desc` | `comicinfo` | `manual`. */
  description_source?: string;
  thumb?: string;
  fetched_at?: string;
  note?: string;
  manual?: Record<string, boolean>;
  /** Unknown keys from newer schemas are preserved on merge. */
  [key: string]: unknown;
}

/** Where a unit's metadata came from during an import. */
export type MetadataOrigin = 'metadata.json' | 'comicinfo' | 'index' | 'filename' | 'none';

/** One unit's outcome, reduced into an {@link ImportReport}. */
export interface ImportEntryResult {
  unit: ImportUnit;
  origin: MetadataOrigin;
  metadata: MetadataFile | null;
  error?: string;
}

/** A unit that could not be enriched; the unit itself is still imported. */
export interface ImportFailure {
  path: string;
  error: string;
}

/** Aggregate counters surfaced by the import dialog (S2). */
export interface ImportReport {
  total: number;
  /** Units with metadata beyond the filename. */
  enriched: number;
  /** Units matched against a sibling index JSON. */
  fromIndex: number;
  /** Units left with only a filename-derived title. */
  fromFilename: number;
  /** Units with no description text of any kind. */
  noDescription: number;
  failed: ImportFailure[];
}
