import { describe, expect, it } from 'vitest';

import { applyCoverFields, needsCoverLookup } from '@/services/manga/cover/applyCoverFields';
import type { CoverFields } from '@/services/manga/cover/coverMetadata';

const cover = (overrides: Partial<CoverFields> = {}): CoverFields => ({
  title: '夜の図書館',
  artist: 'wataya',
  circle: 'circle-a',
  parody: 'original',
  language: 'japanese',
  tags: ['romance', 'school'],
  ...overrides,
});

describe('applyCoverFields', () => {
  it('fills fields that are still empty', () => {
    const result = applyCoverFields({ schema: 1 }, cover());

    expect(result.title).toBe('夜の図書館');
    expect(result.uploader).toBe('wataya');
    expect(result.language).toEqual(['japanese']);
    expect(result.tags).toEqual(['artist:wataya', 'group:circle-a', 'romance', 'school']);
    expect(result['tags_source']).toBe('cover');
  });

  it('keeps the title and artist an index or the user already provided', () => {
    const existing = {
      schema: 1 as const,
      title: 'Known Title',
      uploader: 'Someone',
      language: ['chinese'],
      tags: ['artist:someone', 'group:existing'],
    };

    const result = applyCoverFields(existing, cover({ parody: 'Some Manga' }));

    expect(result.title).toBe('Known Title');
    expect(result.uploader).toBe('Someone');
    // Languages accumulate: a work can be bilingual, so a new one is added
    // once and never duplicated.
    expect(result.language).toEqual(['chinese', 'japanese']);
    expect(result.tags).toEqual([
      'artist:someone',
      'group:existing',
      'parody:Some Manga',
      'romance',
      'school',
    ]);
  });

  it('never writes a field the user marked manual', () => {
    const result = applyCoverFields(
      { schema: 1, manual: { title: true, uploader: true, language: true, tags: true } },
      cover(),
    );

    expect(result.title).toBeUndefined();
    expect(result.uploader).toBeUndefined();
    expect(result.language).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result['tags_source']).toBeUndefined();
  });

  it('does not duplicate a language the metadata already has', () => {
    const result = applyCoverFields(
      { schema: 1, language: ['Japanese'] },
      cover({ language: 'japanese' }),
    );

    expect(result.language).toEqual(['Japanese']);
  });

  it('appends cover tags without repeating an existing one', () => {
    const result = applyCoverFields(
      { schema: 1, tags: ['romance'] },
      cover({ tags: ['Romance', 'school', 'school'] }),
    );

    expect(result.tags).toEqual(['romance', 'artist:wataya', 'group:circle-a', 'school']);
    expect(result['tags_source']).toBe('cover');
  });

  it('omits a parody tag for an original work', () => {
    const result = applyCoverFields({ schema: 1 }, cover({ parody: 'original' }));

    expect(result.tags?.some((tag) => tag.startsWith('parody:'))).toBe(false);
  });
});

describe('needsCoverLookup', () => {
  it('asks for a cover when the title or the artist is missing', () => {
    expect(needsCoverLookup(null)).toBe(true);
    expect(needsCoverLookup({ schema: 1 })).toBe(true);
    expect(needsCoverLookup({ schema: 1, title: 'Titled' })).toBe(true);
    expect(needsCoverLookup({ schema: 1, uploader: 'Artist' })).toBe(true);
  });

  it('skips the cover when both are already known', () => {
    expect(needsCoverLookup({ schema: 1, title: 'Titled', uploader: 'Artist' })).toBe(false);
    expect(needsCoverLookup({ schema: 1, title: 'Titled', tags: ['artist:Artist'] })).toBe(false);
  });
});
