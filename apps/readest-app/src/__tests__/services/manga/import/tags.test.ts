import { describe, expect, it } from 'vitest';

import {
  splitNamespaced,
  summaryFromTags,
  tagValues,
  toComicInfoTags,
} from '@/services/manga/import/tags';

describe('manga import tags', () => {
  it('splits tags by namespace, with un-namespaced tags under ""', () => {
    const grouped = splitNamespaced([
      'language:english',
      'parody:original',
      'artist:wataya',
      'solo',
      'solo',
      'broken:',
      '',
    ]);

    expect(grouped).toEqual({
      language: ['english'],
      parody: ['original'],
      artist: ['wataya'],
      '': ['solo'],
    });
    expect(tagValues(['language:english', 'language:translated'], 'language')).toEqual([
      'english',
      'translated',
    ]);
  });

  it('strips namespaces and duplicates for ComicInfo tags', () => {
    expect(
      toComicInfoTags([
        'artist:wataya',
        'group:trans tribune',
        'male:anal',
        'female:anal',
        'solo',
        'broken:',
      ]),
    ).toBe('wataya, trans tribune, anal, solo');
  });

  it('builds the documented tag summary', () => {
    expect(
      summaryFromTags([
        'language:english',
        'language:translated',
        'parody:original',
        'group:trans tribune',
        'artist:wataya',
      ]),
    ).toBe('英语 translated · 原创 · 团体 trans tribune · 画师 wataya');
  });

  it('orders language first and unnamed tags last', () => {
    expect(
      summaryFromTags([
        'male:anal',
        'other:stockings',
        'artist:wataya',
        'language:japanese',
        'solo',
      ]),
    ).toBe('日语 · 画师 wataya · 男性 anal · 其他 stockings · solo');
  });

  it('returns an empty summary when there are no usable tags', () => {
    expect(summaryFromTags([])).toBe('');
    expect(summaryFromTags(['', 'artist:', '  '])).toBe('');
  });
});
