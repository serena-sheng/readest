import { describe, expect, it } from 'vitest';
import { configureZip } from '@/utils/zip';
import {
  detectAdPageCount,
  detectCbzAdPagesFromFile,
  readImageDimensions,
  type PageDimensions,
} from '@/services/manga/adPages';

// Minimal headers: only what the dimension parser needs.
const jpeg = (width: number, height: number): Uint8Array => {
  const app0 = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // version/density
  ];
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // three components
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ];
  return new Uint8Array([...app0, ...sof, 0xff, 0xd9]);
};

const png = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  return bytes;
};

// Lossless WebP: "VP8L" plus the packed 14-bit width-1 / height-1 pair.
const webp = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(25);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes[20] = 0x2f;
  const w = width - 1;
  const h = height - 1;
  bytes[21] = w & 0xff;
  bytes[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  bytes[23] = (h >> 2) & 0xff;
  bytes[24] = (h >> 10) & 0x0f;
  return bytes;
};

const page = (width: number, height: number): PageDimensions => ({ width, height });

describe('readImageDimensions', () => {
  it('reads a JPEG frame header', () => {
    expect(readImageDimensions(jpeg(800, 1200))).toEqual({ width: 800, height: 1200 });
  });

  it('reads a PNG IHDR header', () => {
    expect(readImageDimensions(png(720, 1080))).toEqual({ width: 720, height: 1080 });
  });

  it('reads a WebP lossless header', () => {
    expect(readImageDimensions(webp(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it('returns null for non-image and truncated bytes', () => {
    expect(readImageDimensions(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(readImageDimensions(jpeg(800, 1200).slice(0, 6))).toBeNull();
    expect(readImageDimensions(png(720, 1080).slice(0, 20))).toBeNull();
    expect(readImageDimensions(new Uint8Array())).toBeNull();
  });
});

describe('detectAdPageCount', () => {
  const base = page(1200, 1600);
  const ad = page(720, 90);

  it('counts two leading pages that differ from the baseline', () => {
    expect(detectAdPageCount([ad, ad, base, base, base, base])).toBe(2);
  });

  it('returns 0 when every page has the same size', () => {
    expect(detectAdPageCount([base, base, base, base, base, base])).toBe(0);
  });

  it('returns 0 when the differing pages exceed maxAds', () => {
    expect(detectAdPageCount([ad, ad, base, base, base, base], { maxAds: 1 })).toBe(0);
  });

  it('returns 0 when too few baseline pages were sampled', () => {
    expect(detectAdPageCount([ad, base, base, null, null, null])).toBe(0);
  });

  it('stops at the first page matching the baseline', () => {
    // The third differing page is later in the book, not a leading ad.
    expect(detectAdPageCount([ad, base, base, base, ad, base])).toBe(1);
  });

  it('returns 0 when the baseline size is ambiguous', () => {
    // Two ad-sized and two comic-sized pages tie, so no baseline is trusted.
    expect(detectAdPageCount([ad, ad, ad, ad, base, base])).toBe(0);
  });
});

describe('detectCbzAdPagesFromFile', () => {
  const pageImage = (width: number, height: number): Blob => {
    // A real header followed by padding, so stored and deflated entries are
    // both large enough to exercise the head reader.
    const bytes = jpeg(width, height);
    const padded = new Uint8Array(bytes.length + 2000);
    padded.set(bytes);
    return new Blob([padded]);
  };

  const makeCbz = async (deflate: boolean): Promise<File> => {
    await configureZip();
    const { BlobWriter, BlobReader, ZipWriter } = await import('@zip.js/zip.js');
    const writer = new ZipWriter(new BlobWriter('application/vnd.comicbook+zip'), {
      useCompressionStream: false,
    });
    const sizes: Array<[number, number]> = [
      [300, 100],
      [320, 120],
      [800, 1200],
      [800, 1200],
      [800, 1200],
      [800, 1200],
    ];
    for (let i = 0; i < sizes.length; i++) {
      await writer.add(
        `p${String(i + 1).padStart(2, '0')}.jpg`,
        new BlobReader(pageImage(...sizes[i]!)),
        { level: deflate ? 6 : 0 },
      );
    }
    return new File([await writer.close()], `io-test-${deflate}.cbz`, {
      type: 'application/vnd.comicbook+zip',
    });
  };

  it('reads stored zip entries', async () => {
    expect(await detectCbzAdPagesFromFile(await makeCbz(false))).toBe(2);
  });

  it('reads deflated zip entries', async () => {
    expect(await detectCbzAdPagesFromFile(await makeCbz(true))).toBe(2);
  });
});
