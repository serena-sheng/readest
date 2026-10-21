import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  buildImportReport,
  comicInfoPathFor,
  comicInfoXml,
  mergeMetadata,
  metadataPathFor,
  readUnitMetadata,
  writeSidecars,
} from '@/services/manga/import/sidecar';
import type { ImportEntryResult, ImportUnit, MetadataFile } from '@/services/manga/import/types';

import { createMemoryFs } from './_memoryFs';

const folder = (path: string): ImportUnit => ({
  kind: 'folder',
  path,
  images: 10,
  title: path.slice(path.lastIndexOf('/') + 1),
});

const ehentaiMetadata: MetadataFile = {
  schema: 1,
  source: 'e-hentai',
  gid: 4264785,
  token: '97f2cdbfa3',
  url: 'https://e-hentai.org/g/4264785/97f2cdbfa3/',
  title: '[Trans Tribune (Wataya)] Dansei shikkaku',
  category: 'Artist CG',
  rating: 2.41,
  pages: 438,
  language: ['english', 'translated'],
  tags: [
    'language:english',
    'language:translated',
    'parody:original',
    'group:trans tribune',
    'artist:wataya',
    'male:anal',
  ],
  description: '',
  description_source: 'e-hentai:none',
};

describe('mergeMetadata', () => {
  it('keeps manual fields and fills the rest from the incoming data', () => {
    const existing: MetadataFile = {
      schema: 1,
      title: 'Hand-edited title',
      tags: ['artist:me'],
      manual: { title: true },
    };
    const incoming: MetadataFile = {
      schema: 1,
      title: 'API title',
      tags: ['artist:wataya'],
      pages: 20,
    };

    const merged = mergeMetadata(existing, incoming);

    expect(merged.title).toBe('Hand-edited title');
    expect(merged.tags).toEqual(['artist:wataya']);
    expect(merged.pages).toBe(20);
    expect(merged.manual).toEqual({ title: true });
  });

  it('does not replace a description whose description_source is not "none"', () => {
    const existing: MetadataFile = {
      schema: 1,
      description: 'A real synopsis from wnacg.',
      description_source: 'wnacg:desc',
    };
    const incoming: MetadataFile = {
      schema: 1,
      description: '',
      description_source: 'e-hentai:none',
    };

    const merged = mergeMetadata(existing, incoming);

    expect(merged.description).toBe('A real synopsis from wnacg.');
    expect(merged.description_source).toBe('wnacg:desc');
  });

  it('accepts a real description over an empty one', () => {
    const existing: MetadataFile = { schema: 1, description: '', description_source: 'none' };
    const incoming: MetadataFile = {
      schema: 1,
      description: 'From the wnacg detail page.',
      description_source: 'wnacg:desc',
    };

    const merged = mergeMetadata(existing, incoming);

    expect(merged.description).toBe('From the wnacg detail page.');
    expect(merged.description_source).toBe('wnacg:desc');
  });
});

describe('writeSidecars', () => {
  it('writes metadata.json and a field-mapped ComicInfo.xml', async () => {
    const fs = createMemoryFs();
    const unit = folder('/lib/work');

    const { changed } = await writeSidecars(unit, ehentaiMetadata, fs);

    expect(changed).toBe(true);
    expect(metadataPathFor(unit)).toBe('/lib/work/metadata.json');
    expect(comicInfoPathFor(unit)).toBe('/lib/work/ComicInfo.xml');

    const stored: unknown = JSON.parse(await fs.readTextFile('/lib/work/metadata.json'));
    expect(stored).toMatchObject({
      schema: 1,
      title: ehentaiMetadata.title,
      tags: ehentaiMetadata.tags,
      description_source: 'e-hentai:none',
    });

    const xml = await fs.readTextFile('/lib/work/ComicInfo.xml');
    expect(xml).toContain('<Title>[Trans Tribune (Wataya)] Dansei shikkaku</Title>');
    expect(xml).toContain('<Series>trans tribune</Series>');
    expect(xml).toContain('<Writer>wataya</Writer>');
    expect(xml).toContain('<Genre>Artist CG</Genre>');
    expect(xml).toContain(
      '<Tags>english, translated, original, trans tribune, wataya, anal</Tags>',
    );
    expect(xml).toContain('<PageCount>438</PageCount>');
    expect(xml).toContain('<LanguageISO>en</LanguageISO>');
    expect(xml).toContain('<Web>https://e-hentai.org/g/4264785/97f2cdbfa3/</Web>');
    expect(xml).toContain('<Rating>2.41</Rating>');
    expect(xml).not.toContain('<Summary>');
  });

  it('is idempotent when re-importing unchanged data', async () => {
    const fs = createMemoryFs();
    const unit = folder('/lib/work');

    const first = await writeSidecars(unit, ehentaiMetadata, fs);
    const second = await writeSidecars(unit, ehentaiMetadata, fs);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(fs.written).toEqual(['/lib/work/metadata.json', '/lib/work/ComicInfo.xml']);
  });

  it('preserves manual fields across a rewrite', async () => {
    const fs = createMemoryFs({
      '/lib/work/metadata.json': JSON.stringify({
        schema: 1,
        title: 'Hand title',
        manual: { title: true },
        tags: ['artist:me'],
      }),
    });
    const unit = folder('/lib/work');

    const { metadata } = await writeSidecars(unit, ehentaiMetadata, fs);

    expect(metadata.title).toBe('Hand title');
    expect(metadata.tags).toEqual(ehentaiMetadata.tags);
    const stored: unknown = JSON.parse(await fs.readTextFile('/lib/work/metadata.json'));
    expect(stored).toMatchObject({ title: 'Hand title', pages: 438 });
  });

  it('writes archive sidecars beside the archive', async () => {
    const fs = createMemoryFs({ '/lib/volume.cbz': zipSync({ '001.jpg': strToU8('a') }) });
    const unit: ImportUnit = {
      kind: 'archive',
      path: '/lib/volume.cbz',
      images: 1,
      title: 'volume',
    };

    await writeSidecars(unit, ehentaiMetadata, fs);

    expect(metadataPathFor(unit)).toBe('/lib/volume.metadata.json');
    expect(comicInfoPathFor(unit)).toBe('/lib/volume.ComicInfo.xml');
    expect(fs.files.has('/lib/volume.metadata.json')).toBe(true);
    expect(fs.files.has('/lib/volume.ComicInfo.xml')).toBe(true);
  });
});

describe('readUnitMetadata', () => {
  it('reads an old ComicInfo.xml when metadata.json is absent', async () => {
    const fs = createMemoryFs({
      '/lib/work/ComicInfo.xml': [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<ComicInfo>',
        '  <Title>Old scanned work</Title>',
        '  <Series>Wataya</Series>',
        '  <Writer>wataya</Writer>',
        '  <Genre>Doujinshi</Genre>',
        '  <Tags>anal, stockings</Tags>',
        '  <Summary>A synopsis written by hand.</Summary>',
        '  <PageCount>12</PageCount>',
        '  <LanguageISO>ja</LanguageISO>',
        '</ComicInfo>',
      ].join('\n'),
    });

    const result = await readUnitMetadata(folder('/lib/work'), fs);

    expect(result.origin).toBe('comicinfo');
    expect(result.metadata).toMatchObject({
      title: 'Old scanned work',
      category: 'Doujinshi',
      description: 'A synopsis written by hand.',
      description_source: 'comicinfo',
      pages: 12,
      language: ['japanese'],
    });
    expect(result.metadata?.tags).toEqual(['artist:wataya', 'group:Wataya', 'anal', 'stockings']);
  });

  it('prefers metadata.json over ComicInfo.xml', async () => {
    const fs = createMemoryFs({
      '/lib/work/metadata.json': JSON.stringify({
        schema: 1,
        title: 'From metadata.json',
        tags: ['artist:wataya'],
      }),
      '/lib/work/ComicInfo.xml': '<ComicInfo><Title>From ComicInfo</Title></ComicInfo>',
    });

    const result = await readUnitMetadata(folder('/lib/work'), fs);

    expect(result.origin).toBe('metadata.json');
    expect(result.metadata?.title).toBe('From metadata.json');
  });

  it('reads a ComicInfo.xml embedded in an archive', async () => {
    const fs = createMemoryFs({
      '/lib/volume.cbz': zipSync({
        '001.jpg': strToU8('a'),
        'ComicInfo.xml': strToU8(
          '<?xml version="1.0"?><ComicInfo><Title>Inside</Title><PageCount>3</PageCount></ComicInfo>',
        ),
      }),
    });
    const unit: ImportUnit = {
      kind: 'archive',
      path: '/lib/volume.cbz',
      images: 1,
      title: 'volume',
    };

    const result = await readUnitMetadata(unit, fs);

    expect(result.origin).toBe('comicinfo');
    expect(result.metadata).toMatchObject({ title: 'Inside', pages: 3 });
  });
});

describe('comicInfoXml', () => {
  it('escapes XML entities', () => {
    const xml = comicInfoXml({
      schema: 1,
      title: 'A & B <C>',
      tags: ['artist:A & B'],
      description: 'Line "quoted"',
    });

    expect(xml).toContain('<Title>A &amp; B &lt;C&gt;</Title>');
    expect(xml).toContain('<Writer>A &amp; B</Writer>');
    expect(xml).toContain('<Summary>Line &quot;quoted&quot;</Summary>');
  });
});

describe('buildImportReport', () => {
  it('counts enriched, index, filename and description-less units', () => {
    const results: ImportEntryResult[] = [
      {
        unit: folder('/lib/from_index'),
        origin: 'index',
        metadata: { schema: 1, title: 'From index', description: '', description_source: 'none' },
      },
      {
        unit: folder('/lib/only_name'),
        origin: 'filename',
        metadata: { schema: 1, title: 'only_name' },
      },
      {
        unit: folder('/lib/with_desc'),
        origin: 'metadata.json',
        metadata: {
          schema: 1,
          title: 'With description',
          description: 'Real synopsis',
          description_source: 'wnacg:desc',
        },
      },
      {
        unit: folder('/lib/broken'),
        origin: 'none',
        metadata: null,
        error: 'E-Hentai API HTTP 500',
      },
    ];

    expect(buildImportReport(results)).toEqual({
      total: 4,
      enriched: 2,
      fromIndex: 1,
      fromFilename: 1,
      noDescription: 3,
      failed: [{ path: '/lib/broken', error: 'E-Hentai API HTTP 500' }],
    });
  });
});
