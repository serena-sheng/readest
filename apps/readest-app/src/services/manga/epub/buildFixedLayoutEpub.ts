/**
 * Builds a fixed-layout (pre-paginated) EPUB 3 from a list of page images.
 *
 * Entries are streamed into a `BlobWriter`: each page's bytes go straight
 * through a reader into the archive, so the builder never concatenates the
 * whole book into one buffer. `mimetype` is written first and stored, as the
 * EPUB specification requires. Every page becomes an XHTML document whose
 * viewport matches the image's intrinsic size when its header can be read,
 * and falls back to 1200×1800 otherwise.
 */

import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

export interface EpubPageInput {
  name: string;
  data: Blob | Uint8Array;
  mimeType: string;
}

export interface FixedLayoutEpubOptions {
  title: string;
  author?: string;
  description?: string;
  tags?: string[];
  /** BCP 47 language tag; defaults to `ja`. */
  language?: string;
  /** Index of the page used as the cover; defaults to 0. */
  coverIndex?: number;
  /** Label shown in the table of contents; defaults to `第 N 页`. */
  pageLabel?: (index: number, name: string) => string;
}

const EPUB_MIMETYPE = 'application/epub+zip';
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 1800;
const HEADER_BYTES = 256 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Extension-derived media type; the caller's `mimeType` wins when present. */
export function mimeTypeForImageName(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Stable, URL-safe image name: spaces and punctuation collapse to `_`, while
 * non-ASCII letters (Chinese page names routinely hit this path) survive.
 */
function safeImageName(name: string, index: number, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '.jpg';
  const cleaned = rawBase
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  const base = cleaned || `page-${index + 1}`;
  let candidate = `${base}${extension}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}${extension}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function pageHref(index: number): string {
  return `pages/p${String(index + 1).padStart(4, '0')}.xhtml`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function headerBytes(data: Blob | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data.subarray(0, HEADER_BYTES);
  return new Uint8Array(await data.slice(0, HEADER_BYTES).arrayBuffer());
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

/** Reads intrinsic dimensions from the image header; null when unknown. */
function parseImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const valid = (width: number, height: number) =>
    width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : null;

  // PNG: IHDR starts right after the 8-byte signature.
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = new DataView(bytes.buffer, bytes.byteOffset).getUint32(16);
    const height = new DataView(bytes.buffer, bytes.byteOffset).getUint32(20);
    return valid(width, height);
  }

  // GIF: logical screen size at offset 6, little-endian.
  if (bytes.length >= 10 && String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') {
    return valid(u16le(bytes, 6), u16le(bytes, 8));
  }

  // BMP: signed 32-bit width/height at offset 18/22; a negative height means
  // top-down rows but keeps the same magnitude.
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return valid(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
  }

  // WebP: RIFF container with a VP8X, VP8 or VP8L chunk.
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') return valid(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
    if (chunk === 'VP8L') {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return valid(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
    }
  }

  // JPEG: walk the segment markers until a start-of-frame segment appears.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 9 < bytes.length) {
      if (bytes[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const marker = bytes[cursor + 1]!;
      if (marker === 0xff) {
        cursor += 1;
        continue;
      }
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        cursor += 2;
        continue;
      }
      const length = u16be(bytes, cursor + 2);
      if (length < 2) break;
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        return valid(u16be(bytes, cursor + 7), u16be(bytes, cursor + 5));
      }
      cursor += 2 + length;
    }
  }

  return null;
}

function pageXhtml(
  options: FixedLayoutEpubOptions,
  label: string,
  imageHref: string,
  size: { width: number; height: number },
): string {
  const language = xmlEscape(options.language ?? 'ja');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head>
<meta charset="utf-8"/>
<title>${xmlEscape(options.title)} — ${xmlEscape(label)}</title>
<meta name="viewport" content="width=${size.width}, height=${size.height}"/>
<style>html,body{margin:0;padding:0;height:100%;background:#000;}img{width:100%;height:100%;object-fit:contain;display:block;}</style>
</head>
<body>
<img src="../images/${imageHref}" alt=""/>
</body>
</html>
`;
}

/**
 * Builds a pre-paginated EPUB 3 from `pages`, preserving their order in the
 * spine. Throws `manga-epub: no pages` for an empty list.
 */
export async function buildFixedLayoutEpub(
  pages: EpubPageInput[],
  options: FixedLayoutEpubOptions,
): Promise<Blob> {
  if (pages.length === 0) throw new Error('manga-epub: no pages');

  const language = options.language ?? 'ja';
  const coverIndex = Math.min(Math.max(0, options.coverIndex ?? 0), Math.max(0, pages.length - 1));
  const labelFor = (index: number) =>
    options.pageLabel?.(index, pages[index]!.name) ?? `第 ${index + 1} 页`;

  const usedNames = new Set<string>();
  const imageNames = pages.map((page, index) => safeImageName(page.name, index, usedNames));
  const imageMimeTypes = pages.map(
    (page, index) => page.mimeType || mimeTypeForImageName(imageNames[index]!),
  );
  const sizes: { width: number; height: number }[] = [];
  for (const page of pages) {
    sizes.push(
      (await parseImageSize(await headerBytes(page.data))) ?? {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      },
    );
  }

  const manifestImages = imageNames
    .map((name, index) => {
      const href = encodeURIComponent(name);
      const properties = index === coverIndex ? ' properties="cover-image"' : '';
      return `    <item id="img-${String(index + 1).padStart(4, '0')}" href="images/${href}" media-type="${imageMimeTypes[index]}"${properties}/>`;
    })
    .join('\n');

  const pageIdFor = (index: number) => `page-${String(index + 1).padStart(4, '0')}`;
  const manifestPages = pages
    .map(
      (_page, index) =>
        `    <item id="${pageIdFor(index)}" href="${pageHref(index)}" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');

  const spine = pages
    .map((_page, index) => `    <itemref idref="${pageIdFor(index)}"/>`)
    .join('\n');

  const subjects = (options.tags ?? [])
    .filter((tag) => tag.trim().length > 0)
    .map((tag) => `    <dc:subject>${xmlEscape(tag)}</dc:subject>`)
    .join('\n');

  const identifier = `urn:readest:manga:${hashString(`${options.title}:${pages.length}`)}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xmlEscape(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <dc:title>${xmlEscape(options.title)}</dc:title>
    <dc:language>${xmlEscape(language)}</dc:language>
${options.author ? `    <dc:creator>${xmlEscape(options.author)}</dc:creator>\n` : ''}${options.description ? `    <dc:description>${xmlEscape(options.description)}</dc:description>\n` : ''}${subjects ? `${subjects}\n` : ''}    <meta property="dcterms:modified">${modified}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta name="cover" content="img-${String(coverIndex + 1).padStart(4, '0')}"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestImages}
${manifestPages}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;

  const tocItems = pages
    .map(
      (_page, index) =>
        `      <li><a href="${pageHref(index)}">${xmlEscape(labelFor(index))}</a></li>`,
    )
    .join('\n');

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xmlEscape(language)}" xml:lang="${xmlEscape(language)}">
<head>
<meta charset="utf-8"/>
<title>${xmlEscape(options.title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>${xmlEscape(options.title)}</h1>
  <ol>
${tocItems}
  </ol>
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
  <ol>
    <li><a epub:type="cover" href="${pageHref(coverIndex)}">${xmlEscape(labelFor(coverIndex))}</a></li>
    <li><a epub:type="toc" href="nav.xhtml">目次</a></li>
    <li><a epub:type="bodymatter" href="${pageHref(0)}">${xmlEscape(labelFor(0))}</a></li>
  </ol>
</nav>
</body>
</html>
`;

  const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  const writer = new ZipWriter(new BlobWriter(EPUB_MIMETYPE));

  // The mimetype entry must come first and stay uncompressed.
  await writer.add('mimetype', new TextReader(EPUB_MIMETYPE), { level: 0 });
  await writer.add('META-INF/container.xml', new TextReader(containerXml), { level: 0 });
  await writer.add('OEBPS/content.opf', new TextReader(contentOpf), { level: 0 });
  await writer.add('OEBPS/nav.xhtml', new TextReader(navXhtml), { level: 0 });

  for (let index = 0; index < pages.length; index += 1) {
    await writer.add(
      `OEBPS/${pageHref(index)}`,
      new TextReader(
        pageXhtml(options, labelFor(index), encodeURIComponent(imageNames[index]!), sizes[index]!),
      ),
      { level: 0 },
    );
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    const reader =
      page.data instanceof Uint8Array ? new Uint8ArrayReader(page.data) : new BlobReader(page.data);
    // Images are already compressed; storing them avoids a pointless deflate.
    await writer.add(`OEBPS/images/${imageNames[index]!}`, reader, { level: 0 });
  }

  return writer.close();
}
