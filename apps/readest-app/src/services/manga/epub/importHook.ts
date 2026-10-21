/**
 * Import-time hook that turns manga sources into EPUBs before they reach
 * `ingestFile`.
 *
 * A `.zip`/`.cbz` selection is converted and replaced by the generated EPUB;
 * when conversion fails the caller gets the original selection back together
 * with `error`, so the import continues with the source file. Dropped
 * folders are only converted when they look like a manga volume (at least
 * {@link MIN_FOLDER_PAGES} top-level images).
 *
 * Cover recognition runs *before* the build: the first page is read ahead of
 * the conversion, its fields are merged into the sidecar metadata, and that
 * merged metadata becomes the builder's options — so the very first generated
 * EPUB already carries the recognized title. The sidecars are rewritten after
 * the conversion with the same values, keeping `metadata.json`/`ComicInfo.xml`
 * in step with the OPF.
 */

import { applyCoverFields, needsCoverLookup } from '../cover/applyCoverFields';
import { extractCoverFields } from '../cover/coverMetadata';
import { basename, isImageFileName, stripExtension } from '../import/fs';
import { readUnitMetadata, writeSidecars } from '../import/sidecar';
import type { ImportUnit, MangaFs, MetadataFile } from '../import/types';
import type { FixedLayoutEpubOptions } from './buildFixedLayoutEpub';
import {
  convertArchiveToEpub,
  convertFolderToEpub,
  createFileMangaFs,
  isMangaArchiveName,
  readArchiveFirstPage,
  readFolderFirstPage,
  type FirstPageImage,
} from './convertMangaToEpub';

/** A dropped folder with fewer images than this is imported as a folder. */
export const MIN_FOLDER_PAGES = 5;

export interface MangaImportSelection {
  file?: File;
  path?: string;
  name?: string;
}

export interface MangaImportDeps {
  /** Required for path sources; `File` sources carry their own bytes. */
  fs?: MangaFs;
  /**
   * Writes the generated EPUB to the Books directory (native) or wraps it in
   * a `File` (web) and returns the value to hand to `ingestFile`.
   */
  persistEpub: (fileName: string, blob: Blob) => Promise<File | string>;
  /**
   * Called with the work title right before the cover goes to the vision
   * model, so the import dialog can show a progress hint.
   */
  onCoverProgress?: (title: string) => void;
  /**
   * Called right before the conversion starts — after any cover lookup — so
   * the conversion hint always follows the cover hint.
   */
  onConvertProgress?: (title: string) => void;
}

export interface PreparedMangaImport {
  /** What the caller should import next: the EPUB, or the original source. */
  importTarget: File | string;
  converted: boolean;
  title: string;
  pageCount: number;
  /** Set when conversion failed and `importTarget` is the original source. */
  error?: string;
}

/** Metadata to build from, plus whether the cover model contributed to it. */
interface BuildMetadata {
  metadata: MetadataFile | null;
  coverApplied: boolean;
}

/** FNV-1a over the source identity; stable across runs for the same source. */
function sourceHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeFileStem(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'manga'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the cover with the vision model before the EPUB is built. Only a work
 * without a title or a credited artist gets a request; anything else already
 * has a better source than a cover.
 *
 * Every failure is swallowed and the sidecar metadata (or `null`) is returned
 * unchanged: cover recognition is enrichment, so a slow model, a bad reply or
 * an unreadable first page must never block the conversion.
 */
async function lookupCoverMetadata(args: {
  unit: ImportUnit;
  fs: MangaFs;
  title: string;
  readFirstPage: () => Promise<FirstPageImage | null>;
  onCoverProgress?: (title: string) => void;
}): Promise<BuildMetadata> {
  let metadata: MetadataFile | null = null;
  try {
    metadata = (await readUnitMetadata(args.unit, args.fs)).metadata;
    // A title plus a credited artist already came from a better source.
    if (!needsCoverLookup(metadata)) return { metadata, coverApplied: false };
    const firstPage = await args.readFirstPage();
    if (!firstPage) return { metadata, coverApplied: false };
    args.onCoverProgress?.(args.title);
    const cover = await extractCoverFields({
      image: firstPage.data,
      mimeType: firstPage.mimeType,
    });
    if (!cover) return { metadata, coverApplied: false };
    const hasFields =
      Boolean(cover.title || cover.artist || cover.circle || cover.parody || cover.language) ||
      cover.tags.length > 0;
    // A model that answered `{}` read nothing; merging it would only make the
    // next import think it has metadata.
    if (!hasFields) return { metadata, coverApplied: false };
    return { metadata: applyCoverFields(metadata, cover), coverApplied: true };
  } catch {
    return { metadata, coverApplied: false };
  }
}

/**
 * The merged metadata as builder options. Explicit overrides win over the
 * sidecar the converter reads, so the OPF is built from exactly the values
 * the sidecars are about to record.
 */
function epubOptionsFrom(
  metadata: MetadataFile | null,
): Partial<FixedLayoutEpubOptions> | undefined {
  if (!metadata) return undefined;
  return {
    title: metadata.title?.trim() || undefined,
    author: metadata.uploader,
    description: metadata.description,
    tags: metadata.tags,
    language: metadata.language?.[0],
  };
}

/** Writes the values the EPUB was built from; enrichment never fails an import. */
async function persistMetadata(
  unit: ImportUnit,
  fs: MangaFs,
  metadata: MetadataFile | null,
): Promise<void> {
  if (!metadata) return;
  try {
    await writeSidecars(unit, metadata, fs);
  } catch {
    // A read-only source still imports; the EPUB is already built.
  }
}

/**
 * Converts one selection when it is a manga archive. Non-manga selections are
 * returned unchanged (`converted: false`, no error).
 */
export async function prepareImportSelection(
  selection: MangaImportSelection,
  deps: MangaImportDeps,
): Promise<PreparedMangaImport | null> {
  const source = selection.file ?? selection.path;
  if (!source) return null;
  const sourceName =
    selection.name || (typeof source === 'string' ? basename(source) : source.name);
  const title = stripExtension(sourceName) || sourceName;

  if (!isMangaArchiveName(sourceName)) {
    return { importTarget: source, converted: false, title, pageCount: 0 };
  }

  const isPath = typeof source === 'string';
  try {
    if (isPath && !deps.fs) {
      throw new Error('manga-epub: no filesystem for path sources');
    }
    const fs = isPath ? deps.fs! : createFileMangaFs(source as File);
    // A `File` source has no writable sidecar location, so cover fields could
    // not be stored anywhere; only path sources get the extra request.
    let build: BuildMetadata = { metadata: null, coverApplied: false };
    if (isPath) {
      const archivePath = source as string;
      build = await lookupCoverMetadata({
        unit: { kind: 'archive', path: archivePath, images: 0, title },
        fs: deps.fs!,
        title,
        readFirstPage: () => readArchiveFirstPage(deps.fs!, archivePath),
        onCoverProgress: deps.onCoverProgress,
      });
    }
    deps.onConvertProgress?.(title);
    const result = await convertArchiveToEpub(source, fs, epubOptionsFrom(build.metadata));
    if (build.coverApplied && isPath) {
      await persistMetadata(
        { kind: 'archive', path: source as string, images: result.pageCount, title },
        deps.fs!,
        build.metadata,
      );
    }
    const fileName = `${safeFileStem(title)}-${sourceHash(`${sourceName}:${result.pageCount}:${result.blob.size}`)}.epub`;
    return {
      importTarget: await deps.persistEpub(fileName, result.blob),
      converted: true,
      title,
      pageCount: result.pageCount,
    };
  } catch (error) {
    return {
      importTarget: source,
      converted: false,
      title,
      pageCount: 0,
      error: errorMessage(error),
    };
  }
}

/**
 * Converts a folder of images when it holds at least {@link MIN_FOLDER_PAGES}
 * top-level images. Returns `null` when the folder is not a manga volume, so
 * the caller keeps its normal folder import.
 */
export async function prepareFolderImport(
  dirPath: string,
  deps: MangaImportDeps,
): Promise<PreparedMangaImport | null> {
  if (!deps.fs) return null;
  let entries;
  try {
    entries = await deps.fs.readDir(dirPath);
  } catch {
    return null;
  }
  const imageCount = entries.filter(
    (entry) => entry.isFile && !entry.name.startsWith('.') && isImageFileName(entry.name),
  ).length;
  if (imageCount < MIN_FOLDER_PAGES) return null;

  const title = stripExtension(basename(dirPath)) || basename(dirPath);
  try {
    const build = await lookupCoverMetadata({
      unit: { kind: 'folder', path: dirPath, images: imageCount, title },
      fs: deps.fs,
      title,
      readFirstPage: () => readFolderFirstPage(dirPath, deps.fs!),
      onCoverProgress: deps.onCoverProgress,
    });
    deps.onConvertProgress?.(title);
    const result = await convertFolderToEpub(dirPath, deps.fs, epubOptionsFrom(build.metadata));
    if (build.coverApplied) {
      await persistMetadata(
        { kind: 'folder', path: dirPath, images: result.pageCount, title },
        deps.fs,
        build.metadata,
      );
    }
    const fileName = `${safeFileStem(title)}-${sourceHash(`${dirPath}:${result.pageCount}:${result.blob.size}`)}.epub`;
    return {
      importTarget: await deps.persistEpub(fileName, result.blob),
      converted: true,
      title,
      pageCount: result.pageCount,
    };
  } catch (error) {
    return {
      importTarget: dirPath,
      converted: false,
      title,
      pageCount: 0,
      error: errorMessage(error),
    };
  }
}
