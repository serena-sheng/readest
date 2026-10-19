/**
 * Detects promotional pages at the start of a comic archive.
 *
 * Site rips of manga often begin with one to three ad pages whose pixel
 * dimensions differ from the comic's own page size. The archive is never
 * modified: the reader only decides which page to open on. Everything here is
 * best-effort and must fail closed — a detection that cannot be made returns
 * zero, so the book opens on its first page exactly as before.
 */
import type { Entry as ZipEntry } from '@zip.js/zip.js';
import { configureZip } from '@/utils/zip';

export type PageDimensions = { width: number; height: number };

/** How many leading pages the detector looks at. */
export const AD_PAGE_SCAN_LIMIT = 6;
/** Pages sampled (0-based) before the baseline size is chosen: from page 3. */
const DEFAULT_SAMPLE_FROM = 2;
/** More differing leading pages than this is treated as a misdetection. */
const DEFAULT_MAX_ADS = 3;
/** Only the image header is needed; this is plenty for JPEG/PNG/WebP. */
const HEAD_BYTES = 4 * 1024;

// Mirrors the extension list in foliate-js/comic-book.js, including its
// case-sensitivity: an entry foliate ignores must not shift our page indices.
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif'];

const readUint16BE = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;

const readUint32BE = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!) >>>
  0;

const matchesAscii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const readJpegDimensions = (bytes: Uint8Array): PageDimensions | null => {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1]!;
    // Fill bytes may repeat 0xFF before the actual marker.
    while (marker === 0xff) {
      offset++;
      if (offset + 1 >= bytes.length) return null;
      marker = bytes[offset + 1]!;
    }
    offset += 2;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > bytes.length) return null;
    const length = readUint16BE(bytes, offset);
    if (length < 2) return null;
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      // SOF: length(2) precision(1) height(2) width(2)
      if (offset + 7 > bytes.length) return null;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
};

const readPngDimensions = (bytes: Uint8Array): PageDimensions | null => {
  if (bytes.length < 24) return null;
  if (!matchesAscii(bytes, 12, 'IHDR')) return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
};

const readWebpDimensions = (bytes: Uint8Array): PageDimensions | null => {
  if (matchesAscii(bytes, 12, 'VP8 ')) {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = readUint16BE(bytes, 26) & 0x3fff;
    const height = readUint16BE(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (matchesAscii(bytes, 12, 'VP8L')) {
    if (bytes.length < 25) return null;
    if (bytes[20] !== 0x2f) return null;
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (matchesAscii(bytes, 12, 'VP8X')) {
    if (bytes.length < 30) return null;
    // Canvas size, minus one, as two 24-bit little-endian values.
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height };
  }
  return null;
};

/**
 * Reads pixel dimensions from a JPEG, PNG or WebP header.
 * Returns null for any other format, a truncated header, or an invalid size.
 */
export function readImageDimensions(bytes: Uint8Array): PageDimensions | null {
  if (!bytes || bytes.length < 2) return null;
  // JPEG: SOI
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dims = readJpegDimensions(bytes);
    return dims && dims.width > 0 && dims.height > 0 ? dims : null;
  }
  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    matchesAscii(bytes, 1, 'PNG\r\n\x1a\n')
  ) {
    return readPngDimensions(bytes);
  }
  // WebP: RIFF....WEBP
  if (bytes.length >= 12 && matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP')) {
    return readWebpDimensions(bytes);
  }
  return null;
}

/**
 * Decides how many leading pages to skip.
 *
 * The baseline size is the most frequent size among pages sampled from
 * `sampleFrom` onwards (default page index 2, i.e. the third page). With fewer
 * than three sampled pages no decision is made. Leading pages whose size
 * differs from the baseline are counted until the first page that matches it;
 * more than `maxAds` such pages means the sizes are not a reliable signal and
 * nothing is skipped.
 */
export function detectAdPageCount(
  dims: Array<PageDimensions | null>,
  opts?: { maxScan?: number; maxAds?: number; sampleFrom?: number },
): number {
  const maxScan = Math.max(1, Math.floor(opts?.maxScan ?? AD_PAGE_SCAN_LIMIT));
  const maxAds = Math.max(0, Math.floor(opts?.maxAds ?? DEFAULT_MAX_ADS));
  const sampleFrom = Math.max(0, Math.floor(opts?.sampleFrom ?? DEFAULT_SAMPLE_FROM));
  const scanned = dims.slice(0, maxScan);

  const counts = new Map<string, { dims: PageDimensions; count: number }>();
  let sampled = 0;
  for (let i = sampleFrom; i < scanned.length; i++) {
    const dim = scanned[i];
    if (!dim) continue;
    sampled++;
    const key = `${dim.width}x${dim.height}`;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { dims: dim, count: 1 });
  }
  if (sampled < 3) return 0;

  let baseline: PageDimensions | null = null;
  let bestCount = 0;
  let tied = false;
  for (const entry of counts.values()) {
    if (entry.count > bestCount) {
      baseline = entry.dims;
      bestCount = entry.count;
      tied = false;
    } else if (entry.count === bestCount) {
      tied = true;
    }
  }
  // Two equally common sizes mean the sample cannot name a baseline.
  if (!baseline || tied) return 0;

  let ads = 0;
  for (const dim of scanned) {
    // An unreadable page cannot be compared; stop rather than guess.
    if (!dim) break;
    if (dim.width === baseline.width && dim.height === baseline.height) break;
    ads++;
  }
  if (ads === 0 || ads > maxAds) return 0;
  return ads;
}

// Same ordering as foliate-js/comic-book.js: numeric segment-wise collation, so
// the detected page indices line up with the reader's section indices.
const comparePaths = (a: string, b: string): number => {
  const collator = new Intl.Collator([], { numeric: true });
  const aSegments = a.split('/');
  const bSegments = b.split('/');
  const length = Math.min(aSegments.length, bSegments.length);
  for (let i = 0; i < length; i++) {
    const cmp = collator.compare(aSegments[i]!, bSegments[i]!);
    if (cmp) return cmp;
  }
  return aSegments.length - bSegments.length;
};

/**
 * Reads the first `limit` decompressed bytes of an entry.
 *
 * Stored entries are sliced straight out of the blob, so a comic's pages are
 * never decompressed in full. Deflated entries use a writer that stops the
 * inflate as soon as the header bytes are in hand.
 */
const readEntryHead = async (
  blob: Blob,
  entry: ZipEntry,
  limit: number,
): Promise<Uint8Array | null> => {
  if (entry.directory) return null;
  if (entry.compressionMethod === 0) {
    // Local file header: signature(4) ... nameLength(2@26) extraLength(2@28),
    // then the file name and extra field, then the raw data.
    const header = new Uint8Array(
      await blob.slice(entry.offset, entry.offset + 30).arrayBuffer(),
    );
    if (
      header.length < 30 ||
      header[0] !== 0x50 ||
      header[1] !== 0x4b ||
      header[2] !== 0x03 ||
      header[3] !== 0x04
    ) {
      return null;
    }
    const nameLength = header[26]! | (header[27]! << 8);
    const extraLength = header[28]! | (header[29]! << 8);
    const start = entry.offset + 30 + nameLength + extraLength;
    const end = Math.min(blob.size, start + limit);
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  // zip.js and the Tauri fs plugin are optional, heavy modules; importing them
  // statically would pull them into every reader bundle. Same convention as
  // libs/document.ts, the other zip consumer.
  const { Uint8ArrayWriter, Writer } = await import('@zip.js/zip.js');
  if (entry.uncompressedSize <= limit) {
    return new Uint8Array(await entry.getData(new Uint8ArrayWriter()));
  }
  class HeadWriter extends Writer<Uint8Array> {
    private chunks: Uint8Array[] = [];
    private length = 0;
    stopped = false;

    override async writeUint8Array(chunk: Uint8Array): Promise<void> {
      const take = Math.min(chunk.length, limit - this.length);
      if (take > 0) {
        this.chunks.push(chunk.slice(0, take));
        this.length += take;
      }
      if (this.length >= limit) {
        this.stopped = true;
        throw new Error('ad-page header limit reached');
      }
    }

    override async getData(): Promise<Uint8Array> {
      const out = new Uint8Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
  }
  const writer = new HeadWriter();
  try {
    await entry.getData(writer);
  } catch (error) {
    if (!writer.stopped) throw error;
  }
  return writer.getData();
};

const detectFromBlob = async (blob: Blob): Promise<number> => {
  await configureZip();
  // Kept dynamic like every other zip.js consumer in the app (libs/document.ts,
  // utils/txt.ts) so the reader bundle only pays for it when a comic opens.
  const { ZipReader, BlobReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const pages = entries
      .filter((entry) => !entry.directory && IMAGE_EXTS.some((ext) => entry.filename.endsWith(ext)))
      .sort((a, b) => comparePaths(a.filename, b.filename));
    const dims = await Promise.all(
      pages
        .slice(0, AD_PAGE_SCAN_LIMIT)
        .map(async (entry) => {
          try {
            const head = await readEntryHead(blob, entry, HEAD_BYTES);
            return head ? readImageDimensions(head) : null;
          } catch {
            return null;
          }
        }),
    );
    return detectAdPageCount(dims);
  } finally {
    await reader.close();
  }
};

// A page count is stable for as long as the file bytes are: key by path and
// mtime, or by the in-memory file's identity on web.
const cache = new Map<string, number>();

/** Test seam; production never needs to clear the cache. */
export function resetAdPageCacheForTests(): void {
  cache.clear();
}

/**
 * Opens a CBZ by path and counts the ad pages at its start.
 *
 * Native only: the file is read through a lazily sliced `NativeFile`, so zip.js
 * sees a normal Blob while only the central directory and the first 4KB of the
 * leading images are actually read. When the path cannot be read (missing, no
 * native fs, out of scope) `fallbackFile` — usually the file already loaded by
 * the reader — is used instead. Any failure returns 0.
 */
export async function detectCbzAdPages(filePath: string, fallbackFile?: File): Promise<number> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const info = await stat(filePath);
    const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
    const key = `path:${filePath}:${mtime}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const { NativeFile } = await import('@/utils/file');
    const file = await new NativeFile(filePath).open();
    try {
      const count = await detectFromBlob(file);
      cache.set(key, count);
      return count;
    } finally {
      await file.close();
    }
  } catch (error) {
    console.warn('Failed to detect CBZ ad pages:', error);
    // The native path may sit outside this app's fs scope (mobile); the
    // already-open file goes through the app's own reader instead.
    return fallbackFile ? detectCbzAdPagesFromFile(fallbackFile) : 0;
  }
}

/**
 * Counts leading ad pages from an already-loaded archive file. Used on web and
 * whenever the reader holds the file but not a native path.
 */
export async function detectCbzAdPagesFromFile(file: File): Promise<number> {
  const key = `file:${file.name}:${file.size}:${file.lastModified}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const count = await detectFromBlob(file);
    cache.set(key, count);
    return count;
  } catch (error) {
    console.warn('Failed to detect CBZ ad pages:', error);
    return 0;
  }
}
