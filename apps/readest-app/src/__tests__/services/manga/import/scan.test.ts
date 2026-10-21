import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { MIN_FOLDER_IMAGES, scanImportUnits } from '@/services/manga/import/scan';

import { createMemoryFs } from './_memoryFs';

function images(prefix: string, count: number, extension = 'jpg'): Record<string, string> {
  const seed: Record<string, string> = {};
  for (let index = 1; index <= count; index += 1) {
    seed[`${prefix}/${String(index).padStart(4, '0')}.${extension}`] = 'page';
  }
  return seed;
}

describe('scanImportUnits', () => {
  it('finds folders and archives in a mixed directory, skipping imageless folders', async () => {
    const archive = zipSync({
      '001.jpg': strToU8('a'),
      '002.png': strToU8('b'),
      'ComicInfo.xml': strToU8('<ComicInfo />'),
    });
    const fs = createMemoryFs({
      ...images('/lib/dansei_en', 6),
      ...images('/lib/single_chapter', 1),
      '/lib/conv/notes.txt': 'conversion scratch',
      '/lib/readme.txt': 'not a book',
      '/lib/ignored.cbr': 'unsupported extension',
      '/lib/136743.zip': archive,
    });

    const units = await scanImportUnits('/lib', fs);

    expect(units.map((unit) => [unit.kind, unit.title, unit.images])).toEqual([
      ['archive', '136743', 2],
      ['folder', 'dansei_en', 6],
    ]);
  });

  it('requires at least MIN_FOLDER_IMAGES direct images for a folder unit', async () => {
    const below = MIN_FOLDER_IMAGES - 1;
    const fs = createMemoryFs({
      ...images('/lib/too_few', below),
      ...images('/lib/exact', MIN_FOLDER_IMAGES),
      ...images('/lib/exact/chapters', MIN_FOLDER_IMAGES),
      '/lib/exact/notes.txt': 'not an image',
      '/lib/exact/.DS_Store': 'hidden',
    });

    const units = await scanImportUnits('/lib', fs);

    expect(units).toHaveLength(1);
    // Nested chapter images are not counted: one folder is one work.
    expect(units[0]).toMatchObject({ kind: 'folder', title: 'exact', images: MIN_FOLDER_IMAGES });
  });

  it('counts archive pages from the ZIP central directory, including subfolders', async () => {
    const archive = zipSync({
      '001.jpg': strToU8('a'),
      '002.JPEG': strToU8('b'),
      '003.webp': strToU8('c'),
      'ch02/004.png': strToU8('d'),
      'ComicInfo.xml': strToU8('<ComicInfo />'),
      'notes.txt': strToU8('n'),
      '__MACOSX/._001.jpg': strToU8('x'),
    });
    const fs = createMemoryFs({ '/lib/volume.cbz': archive });

    const [unit] = await scanImportUnits('/lib', fs);

    expect(unit).toMatchObject({ kind: 'archive', title: 'volume', images: 4 });
  });

  it('keeps an unreadable archive visible with zero pages', async () => {
    const fs = createMemoryFs({
      '/lib/broken.cbz': 'this is not a zip file',
      '/lib/real.zip': zipSync({ '001.jpg': strToU8('a') }),
    });

    const units = await scanImportUnits('/lib', fs);

    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ kind: 'archive', title: 'broken', images: 0 });
    expect(units[1]).toMatchObject({ kind: 'archive', title: 'real', images: 1 });
  });
});
