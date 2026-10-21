/**
 * Read-only ZIP inspection for manga imports.
 *
 * Only the central directory is read (plus a single entry when reading
 * `ComicInfo.xml`), so scanning a 400 MB CBZ does not load the archive into
 * memory. ZIP64 end-of-central-directory records are followed when present.
 */

import { inflateSync } from 'fflate';
import { isImageFileName } from './fs';
import type { MangaFs } from './types';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const MAX_ENTRY_COMMENT_AND_EXTRA = 0xffff;

/** One file entry from the archive's central directory. */
export interface ZipCentralEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
}

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): number {
  return Number(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true),
  );
}

/** True when a ZIP entry name is a page image (macOS resource forks excluded). */
function isZipImageEntry(name: string): boolean {
  if (name.endsWith('/') || name.startsWith('__MACOSX/')) return false;
  const base = name.slice(name.lastIndexOf('/') + 1);
  return base.length > 0 && !base.startsWith('.') && isImageFileName(base);
}

async function readEndOfCentralDirectory(
  fs: MangaFs,
  path: string,
  size: number,
): Promise<{ totalEntries: number; centralOffset: number; centralSize: number } | null> {
  if (size < EOCD_MIN_BYTES) return null;

  // The EOCD record is 22 bytes plus a comment of at most 64 KiB.
  const tailStart = Math.max(0, size - (EOCD_MIN_BYTES + MAX_ENTRY_COMMENT_AND_EXTRA));
  const tail = await fs.readFileSlice(path, tailStart, size - tailStart);

  let eocd = -1;
  for (let i = tail.length - EOCD_MIN_BYTES; i >= 0; i -= 1) {
    // Require the record's comment length to land within the tail; this stops
    // a comment that happens to contain the signature from being taken as EOCD.
    if (u32(tail, i) === EOCD_SIGNATURE && i + EOCD_MIN_BYTES + u16(tail, i + 20) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  let totalEntries = u16(tail, eocd + 10);
  let centralSize = u32(tail, eocd + 12);
  let centralOffset = u32(tail, eocd + 16);

  const needsZip64 =
    totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff;
  const eocdAbsolute = tailStart + eocd;
  if (needsZip64 && eocdAbsolute >= 20) {
    const locator = await fs.readFileSlice(path, eocdAbsolute - 20, 20);
    if (u32(locator, 0) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = u64(locator, 8);
      const zip64 = await fs.readFileSlice(path, zip64Offset, 56);
      if (u32(zip64, 0) === ZIP64_EOCD_SIGNATURE) {
        totalEntries = u64(zip64, 32);
        centralSize = u64(zip64, 40);
        centralOffset = u64(zip64, 48);
      }
    }
  }

  return { totalEntries, centralOffset, centralSize };
}

/**
 * Lists every entry in the archive's central directory.
 *
 * Returns an empty array for a non-ZIP file or a truncated archive; callers
 * treat that as "no pages" rather than failing the whole scan.
 */
export async function readZipEntries(fs: MangaFs, path: string): Promise<ZipCentralEntry[]> {
  const info = await fs.stat(path);
  if (!info.isFile) return [];

  const eocd = await readEndOfCentralDirectory(fs, path, info.size);
  if (!eocd || eocd.centralSize === 0 || eocd.totalEntries === 0) return [];
  if (eocd.centralOffset + eocd.centralSize > info.size) return [];

  const central = await fs.readFileSlice(path, eocd.centralOffset, eocd.centralSize);
  const entries: ZipCentralEntry[] = [];
  let cursor = 0;

  while (cursor + 46 <= central.length && entries.length < eocd.totalEntries) {
    if (u32(central, cursor) !== CENTRAL_SIGNATURE) break;

    const compressionMethod = u16(central, cursor + 10);
    const compressedSize = u32(central, cursor + 20);
    const uncompressedSize = u32(central, cursor + 24);
    const nameLength = u16(central, cursor + 28);
    const extraLength = u16(central, cursor + 30);
    const commentLength = u16(central, cursor + 32);
    const localHeaderOffset = u32(central, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > central.length) break;

    const name = new TextDecoder('utf-8').decode(central.subarray(nameStart, nameEnd));
    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });

    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

/** Counts page images in an archive. Empty for non-ZIP or corrupt files. */
export async function countZipImages(fs: MangaFs, path: string): Promise<number> {
  const entries = await readZipEntries(fs, path);
  return entries.filter((entry) => isZipImageEntry(entry.name)).length;
}

/**
 * Reads one entry's uncompressed bytes.
 *
 * `entry` must come from {@link readZipEntries} for the same archive. ZIP64
 * entries are rejected: the central directory reader does not resolve their
 * extra fields, so their sizes and offsets are not trustworthy yet.
 */
export async function readZipEntryData(
  fs: MangaFs,
  archivePath: string,
  entry: ZipCentralEntry,
): Promise<Uint8Array> {
  if (entry.compressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
    throw new Error(`ZIP64 entry "${entry.name}" is not supported`);
  }

  const localHeader = await fs.readFileSlice(archivePath, entry.localHeaderOffset, 30);
  if (u32(localHeader, 0) !== LOCAL_SIGNATURE) {
    throw new Error(`Invalid local header for "${entry.name}"`);
  }
  const headerNameLength = u16(localHeader, 26);
  const headerExtraLength = u16(localHeader, 28);
  const dataStart = entry.localHeaderOffset + 30 + headerNameLength + headerExtraLength;

  const compressed = await fs.readFileSlice(archivePath, dataStart, entry.compressedSize);
  return entry.compressionMethod === 0
    ? compressed
    : entry.compressionMethod === 8
      ? inflateSync(compressed)
      : (() => {
          throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}`);
        })();
}

/**
 * Reads one file from the archive as UTF-8 text.
 *
 * `fileName` is matched case-insensitively against the entry basename; the
 * shallowest match wins, which is what `ComicInfo.xml` at the archive root
 * requires. Returns `null` when no entry matches.
 */
export async function readZipEntryText(
  fs: MangaFs,
  archivePath: string,
  fileName: string,
): Promise<string | null> {
  const wanted = fileName.toLowerCase();
  const entries = await readZipEntries(fs, archivePath);
  const matches = entries
    .filter((entry) => {
      const base = entry.name.slice(entry.name.lastIndexOf('/') + 1).toLowerCase();
      return base === wanted;
    })
    .sort(
      (a, b) =>
        a.name.split('/').length - b.name.split('/').length || a.name.length - b.name.length,
    );
  const entry = matches[0];
  if (!entry) return null;

  return new TextDecoder('utf-8').decode(await readZipEntryData(fs, archivePath, entry));
}
