import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import {
  convertArchiveToEpub,
  convertFolderToEpub,
} from '@/services/manga/epub/convertMangaToEpub';
import { createMemoryFs } from '../import/_memoryFs';
import { inspectZip, pageImageNames, pngBytes } from './_epubTestUtils';

const image = () => pngBytes(600, 900);

function archive(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 0 });
}

describe('convertArchiveToEpub', () => {
  it('preserves the ZIP central-directory order instead of sorting names', async () => {
    const fs = createMemoryFs({
      '/lib/book.zip': archive({
        'b.png': image(),
        '10.jpg': image(),
        '2.jpg': image(),
      }),
    });

    const result = await convertArchiveToEpub('/lib/book.zip', fs);
    const inspection = await inspectZip(result.blob);

    expect(result.order).toBe('archive');
    expect(result.pageCount).toBe(3);
    expect(pageImageNames(inspection)).toEqual(['b.png', '10.jpg', '2.jpg']);
  });

  it('skips __MACOSX entries, hidden files and non-images', async () => {
    const fs = createMemoryFs({
      '/lib/book.zip': archive({
        '001.png': image(),
        '__MACOSX/._001.png': image(),
        '.hidden.jpg': image(),
        'notes.txt': new TextEncoder().encode('not a page'),
        '002.webp': image(),
      }),
    });

    const result = await convertArchiveToEpub('/lib/book.zip', fs);
    const inspection = await inspectZip(result.blob);

    expect(result.pageCount).toBe(2);
    expect(pageImageNames(inspection)).toEqual(['001.png', '002.webp']);
    expect(result.skipped).toEqual(['__MACOSX/._001.png', '.hidden.jpg', 'notes.txt']);
  });

  it('derives the default title from the archive name', async () => {
    const fs = createMemoryFs({ '/lib/My Book.zip': archive({ 'page.png': image() }) });

    const result = await convertArchiveToEpub('/lib/My Book.zip', fs);

    expect((await inspectZip(result.blob)).text('OEBPS/content.opf')).toContain(
      '<dc:title>My Book</dc:title>',
    );
  });
});

describe('convertFolderToEpub', () => {
  it('sorts page files naturally and ignores nested folders', async () => {
    const fs = createMemoryFs({
      '/lib/vol/page10.jpg': image(),
      '/lib/vol/page2.jpg': image(),
      '/lib/vol/page1.jpg': image(),
      '/lib/vol/nested/page3.jpg': image(),
      '/lib/vol/.hidden.jpg': image(),
      '/lib/vol/readme.txt': new TextEncoder().encode('x'),
    });

    const result = await convertFolderToEpub('/lib/vol', fs);
    const inspection = await inspectZip(result.blob);

    expect(result.order).toBe('sorted');
    expect(result.pageCount).toBe(3);
    expect(pageImageNames(inspection)).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg']);
  });

  it('uses metadata.json for title, author and language', async () => {
    const fs = createMemoryFs({
      '/lib/vol/page1.png': image(),
      '/lib/vol/metadata.json': JSON.stringify({
        schema: 1,
        title: '作品甲',
        uploader: 'wataya',
        language: ['ja'],
        tags: ['artist:wataya'],
        description: 'あらすじ',
      }),
    });

    const result = await convertFolderToEpub('/lib/vol', fs);
    const opf = (await inspectZip(result.blob)).text('OEBPS/content.opf');

    expect(opf).toContain('<dc:title>作品甲</dc:title>');
    expect(opf).toContain('<dc:creator>wataya</dc:creator>');
    expect(opf).toContain('<dc:language>ja</dc:language>');
    expect(opf).toContain('<dc:subject>artist:wataya</dc:subject>');
  });

  it('lets explicit metadata override the sidecar', async () => {
    const fs = createMemoryFs({
      '/lib/vol/page1.png': image(),
      '/lib/vol/metadata.json': JSON.stringify({ schema: 1, title: 'Sidecar' }),
    });

    const result = await convertFolderToEpub('/lib/vol', fs, { title: 'Override' });

    expect((await inspectZip(result.blob)).text('OEBPS/content.opf')).toContain(
      '<dc:title>Override</dc:title>',
    );
  });

  it('falls back to the folder name when no metadata exists', async () => {
    const fs = createMemoryFs({ '/lib/vol/page1.png': image() });

    const result = await convertFolderToEpub('/lib/vol', fs);

    expect((await inspectZip(result.blob)).text('OEBPS/content.opf')).toContain(
      '<dc:title>vol</dc:title>',
    );
  });
});
