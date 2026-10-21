/**
 * Converts manga sources into fixed-layout EPUBs.
 *
 * Archives keep the ZIP central-directory order, which is the order the
 * publisher wrote the pages in (filename order is often wrong for scans that
 * reset numbering per chapter). Folders sort naturally instead, so `page2`
 * precedes `page10`. Non-image entries, `__MACOSX/` resource forks, hidden
 * files and nested folders are skipped and reported in `skipped`.
 */

import { basename, isImageFileName, joinPath, stripExtension } from '../import/fs';
import { readMetadataFile } from '../import/sidecar';
import type { ImportUnit, MangaFs, MetadataFile } from '../import/types';
import { readZipEntries, readZipEntryData } from '../import/zip';
import {
  buildFixedLayoutEpub,
  mimeTypeForImageName,
  type EpubPageInput,
  type FixedLayoutEpubOptions,
} from './buildFixedLayoutEpub';

export interface ConvertResult {
  blob: Blob;
  pageCount: number;
  /** Source entries that were not used as pages. */
  skipped: string[];
  order: 'archive' | 'sorted';
  /** The first page, so the import hook can read cover metadata from it. */
  firstPage?: { data: Uint8Array | Blob; mimeType: string };
}

const ARCHIVE_EXTENSIONS: Record<string, true> = { zip: true, cbz: true };

/** True when `name` (path or plain file name) is a manga archive. */
export function isMangaArchiveName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return ARCHIVE_EXTENSIONS[name.slice(dot + 1).toLowerCase()] === true;
}

/** `__MACOSX/…`, resource forks and dotfiles are never pages. */
function isSkippedEntryPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.') || segment === '__MACOSX');
}

/** One page image, as read ahead of the conversion for a cover lookup. */
export interface FirstPageImage {
  data: Uint8Array;
  mimeType: string;
}

/** A top-level image entry that counts as a page (directories never do). */
function isPageEntryName(name: string): boolean {
  if (name.endsWith('/')) return false;
  const base = basename(name);
  return !isSkippedEntryPath(name) && !base.startsWith('.') && isImageFileName(base);
}

/**
 * A `MangaFs` view over a browser `File`, so a dropped archive goes through
 * exactly the same ZIP reader as a path on disk.
 */
export function createFileMangaFs(file: File): MangaFs {
  const unavailable = async (): Promise<never> => {
    throw new Error('manga-epub: File sources have no directory listing');
  };
  return {
    readTextFile: unavailable,
    writeTextFile: unavailable,
    readDir: unavailable,
    async stat() {
      return { size: file.size, isFile: true, isDirectory: false };
    },
    async readFileSlice(_path: string, offset: number, length: number) {
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}

async function readWholeFile(fs: MangaFs, path: string): Promise<Uint8Array> {
  const info = await fs.stat(path);
  return fs.readFileSlice(path, 0, info.size);
}

function titleFromSourcePath(path: string): string {
  return stripExtension(basename(path)) || basename(path);
}

/**
 * Overrides win over sidecar metadata; missing override fields fall back to
 * the sidecar, then to the builder's defaults.
 */
function optionsFor(
  title: string,
  metadata: MetadataFile | null,
  overrides: Partial<FixedLayoutEpubOptions> | undefined,
): FixedLayoutEpubOptions {
  return {
    title: overrides?.title ?? (metadata?.title?.trim() || title),
    author: overrides?.author ?? metadata?.uploader,
    description: overrides?.description ?? metadata?.description,
    tags: overrides?.tags ?? metadata?.tags,
    language: overrides?.language ?? metadata?.language?.[0],
    coverIndex: overrides?.coverIndex,
    pageLabel: overrides?.pageLabel,
  };
}

/**
 * Reads the sidecar `metadata.json` for a unit. A missing or unreadable
 * sidecar is normal, not an error.
 */
async function readSidecar(fs: MangaFs, unit: ImportUnit): Promise<MetadataFile | null> {
  try {
    return await readMetadataFile(unit, fs);
  } catch {
    return null;
  }
}

/**
 * Reads the first page image of an archive in central-directory order — the
 * same page the conversion puts first — so the cover can be read before the
 * EPUB is built. Returns `null` for a non-ZIP or a page-less archive.
 */
export async function readArchiveFirstPage(
  fs: MangaFs,
  archivePath: string,
): Promise<FirstPageImage | null> {
  const entries = await readZipEntries(fs, archivePath);
  const first = entries.find((entry) => isPageEntryName(entry.name));
  if (!first) return null;
  return {
    data: await readZipEntryData(fs, archivePath, first),
    mimeType: mimeTypeForImageName(basename(first.name)),
  };
}

/**
 * Converts a `.zip`/`.cbz` archive (path or browser `File`) to a fixed-layout
 * EPUB, preserving the archive's central-directory order.
 */
export async function convertArchiveToEpub(
  file: File | string,
  fs: MangaFs,
  metadata?: Partial<FixedLayoutEpubOptions>,
): Promise<ConvertResult> {
  const isFile = typeof file !== 'string';
  const sourceFs = isFile ? createFileMangaFs(file) : fs;
  const sourceName = isFile ? file.name : file;
  const path = isFile ? sourceName : file;

  const entries = await readZipEntries(sourceFs, path);
  const pages: EpubPageInput[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!isPageEntryName(entry.name)) {
      if (!entry.name.endsWith('/')) skipped.push(entry.name);
      continue;
    }
    const name = basename(entry.name);
    pages.push({
      name,
      data: await readZipEntryData(sourceFs, path, entry),
      mimeType: mimeTypeForImageName(name),
    });
  }

  const sidecar = isFile
    ? null
    : await readSidecar(fs, {
        kind: 'archive',
        path,
        images: pages.length,
        title: titleFromSourcePath(path),
      });
  const blob = await buildFixedLayoutEpub(
    pages,
    optionsFor(titleFromSourcePath(sourceName), sidecar, metadata),
  );

  return {
    blob,
    pageCount: pages.length,
    skipped,
    order: 'archive',
    firstPage: pages[0] ? { data: pages[0].data, mimeType: pages[0].mimeType } : undefined,
  };
}

/** Natural ordering: `page2` sorts before `page10`. */
function naturalCompare(a: string, b: string): number {
  const result = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return result !== 0 ? result : a.localeCompare(b);
}

/**
 * Reads the first page image of a folder in natural filename order — the same
 * page the conversion puts first — so the cover can be read before the EPUB
 * is built. Returns `null` when the folder holds no top-level images.
 */
export async function readFolderFirstPage(
  dirPath: string,
  fs: MangaFs,
): Promise<FirstPageImage | null> {
  const entries = await fs.readDir(dirPath);
  const first = entries
    .filter((entry) => entry.isFile && isPageEntryName(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name))[0];
  if (!first) return null;
  return {
    data: await readWholeFile(fs, first.path),
    mimeType: mimeTypeForImageName(first.name),
  };
}

/**
 * Converts a directory of images (top level only, subdirectories ignored) to
 * a fixed-layout EPUB in natural filename order.
 */
export async function convertFolderToEpub(
  dirPath: string,
  fs: MangaFs,
  metadata?: Partial<FixedLayoutEpubOptions>,
): Promise<ConvertResult> {
  const entries = await fs.readDir(dirPath);
  const skipped: string[] = [];
  const imageEntries = entries.filter((entry) => {
    if (!entry.isFile) return false;
    if (!isPageEntryName(entry.name)) {
      skipped.push(joinPath(dirPath, entry.name));
      return false;
    }
    return true;
  });
  imageEntries.sort((a, b) => naturalCompare(a.name, b.name));

  const pages: EpubPageInput[] = [];
  for (const entry of imageEntries) {
    pages.push({
      name: entry.name,
      data: await readWholeFile(fs, entry.path),
      mimeType: mimeTypeForImageName(entry.name),
    });
  }

  const defaultTitle = titleFromSourcePath(dirPath);
  const sidecar = await readSidecar(fs, {
    kind: 'folder',
    path: dirPath,
    images: pages.length,
    title: defaultTitle,
  });
  const blob = await buildFixedLayoutEpub(pages, optionsFor(defaultTitle, sidecar, metadata));

  return {
    blob,
    pageCount: pages.length,
    skipped,
    order: 'sorted',
    firstPage: pages[0] ? { data: pages[0].data, mimeType: pages[0].mimeType } : undefined,
  };
}
