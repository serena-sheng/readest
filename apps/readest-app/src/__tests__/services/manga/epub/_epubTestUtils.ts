/**
 * Test-only helpers for the fixed-layout EPUB tests: a minimal PNG header,
 * a ZIP central-directory inspector, and a page-image extractor.
 */

import { unzipSync } from 'fflate';

/** A PNG whose IHDR carries `width`×`height`; only the header is real. */
export function pngBytes(width = 800, height = 1200): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // colour type
  return bytes;
}

export interface ZipInspection {
  names: string[];
  methods: number[];
  text: (name: string) => string;
  bytes: (name: string) => Uint8Array;
}

export async function inspectZip(blob: Blob): Promise<ZipInspection> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();

  let eocd = -1;
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const total = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const methods: number[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < total; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad central directory');
    methods.push(view.getUint16(cursor + 10, true));
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    names.push(decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const files = unzipSync(data);
  const bytes = (name: string) => {
    const file = files[name];
    if (!file) throw new Error(`zip entry not found: ${name}`);
    return file;
  };
  return {
    names,
    methods,
    bytes,
    text: (name: string) => decoder.decode(bytes(name)),
  };
}

/** Image names referenced by the page documents, in spine order. */
export function pageImageNames(inspection: ZipInspection): string[] {
  const pages = inspection.names.filter((name) => name.startsWith('OEBPS/pages/')).sort();
  return pages.map((page) => {
    const match = /<img src="\.\.\/images\/([^"]+)"/.exec(inspection.text(page));
    return match ? decodeURIComponent(match[1]!) : '';
  });
}
