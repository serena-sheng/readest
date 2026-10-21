import { describe, expect, it } from 'vitest';

import {
  loadSiblingIndexes,
  matchIndexForUnit,
  matchIndexRecord,
  parseIndex,
} from '@/services/manga/import/indexMatch';
import type { ImportUnit } from '@/services/manga/import/types';

import { createMemoryFs } from './_memoryFs';

const unit = (path: string, title: string): ImportUnit => ({
  kind: 'folder',
  path,
  images: 10,
  title,
});

describe('parseIndex', () => {
  it('normalizes plan, eh, list and wn rows', () => {
    const [plan] = parseIndex('plan', [
      {
        gid: '4264785',
        token: '97f2cdbfa3',
        pages: 438,
        slug: 'dansei_en',
        note: '男性失格 英译全本',
        lang: ['english', 'translated'],
        title: 'Dansei shikkaku',
      },
    ]);
    expect(plan).toMatchObject({
      source: 'plan',
      gid: '4264785',
      token: '97f2cdbfa3',
      slug: 'dansei_en',
      pages: 438,
      lang: ['english', 'translated'],
      note: '男性失格 英译全本',
    });

    const [eh] = parseIndex('eh', [
      {
        gid: '4264785',
        token: '97f2cdbfa3',
        title: 'Dansei shikkaku',
        lang: ['english'],
        pages: '438',
        thumb: 'https://ehgt.org/a.webp',
        hash: 1,
      },
    ]);
    expect(eh).toMatchObject({ source: 'eh', pages: 438, thumb: 'https://ehgt.org/a.webp' });

    const [listed] = parseIndex('list', [
      {
        gid: 4264785,
        token: '97f2cdbfa3',
        title: 'Dansei shikkaku',
        posted: '2026-10-18 18:08',
        uploader: 'dawei123',
      },
    ]);
    expect(listed).toMatchObject({
      source: 'list',
      gid: '4264785',
      posted: '2026-10-18 18:08',
      uploader: 'dawei123',
    });

    const [wn] = parseIndex('wn', [
      {
        aid: '322395',
        href: '/photos-index-aid-322395.html',
        title: '[綿谷しんぐ] 男性失格',
        pages: 439,
        cat: '同人誌／漢化',
        tags: [],
        cover: null,
      },
    ]);
    expect(wn).toMatchObject({
      source: 'wn',
      aid: '322395',
      href: '/photos-index-aid-322395.html',
      pages: 439,
      category: '同人誌／漢化',
    });
    expect(wn?.tags).toBeUndefined();

    expect(parseIndex('wn', { not: 'an array' })).toEqual([]);
  });
});

describe('matchIndexRecord', () => {
  const planRecord = parseIndex('plan', [
    { gid: '1', token: 'aaa', slug: 'dansei_en', title: 'Dansei shikkaku', pages: 438 },
  ]);
  const ehRecords = parseIndex('eh', [
    { gid: '1', token: 'aaa', title: 'Dansei shikkaku', pages: 438 },
    { gid: '4264785', token: '97f2cdbfa3', title: 'Ibara no ie', pages: 20 },
  ]);
  const wnRecords = parseIndex('wn', [
    { aid: '322395', href: '/photos-index-aid-322395.html', title: '男性失格', pages: 439 },
  ]);

  it('matches a unit folder name against the index slug first', () => {
    const match = matchIndexRecord(unit('/lib/dansei_en', 'Dansei shikkaku'), [
      ...ehRecords,
      ...planRecord,
    ]);

    expect(match?.matchedBy).toBe('slug');
    expect(match?.record).toMatchObject({ source: 'plan', slug: 'dansei_en' });
  });

  it('matches gid and token present anywhere in the unit path', () => {
    const match = matchIndexRecord(
      unit('/lib/4264785_97f2cdbfa3', '4264785_97f2cdbfa3'),
      ehRecords,
    );

    expect(match?.matchedBy).toBe('gid-token');
    expect(match?.record.gid).toBe('4264785');
  });

  it('matches gid and token found inside the folder listing', async () => {
    const fs = createMemoryFs({ '/lib/unknown/4264785_97f2cdbfa3/001.jpg': 'page' });

    const match = await matchIndexForUnit(unit('/lib/unknown', 'unknown'), ehRecords, fs);

    expect(match?.matchedBy).toBe('gid-token');
    expect(match?.record.gid).toBe('4264785');
  });

  it('matches a wnacg aid from a wn_-prefixed folder name', () => {
    const match = matchIndexRecord(unit('/lib/wn_322395', 'wn_322395'), wnRecords);

    expect(match?.matchedBy).toBe('aid');
    expect(match?.record.aid).toBe('322395');
  });

  it('falls back to an exact title match with whitespace collapsed', () => {
    const match = matchIndexRecord(
      unit('/lib/manga', 'Dansei   shikkaku'),
      parseIndex('eh', [{ gid: '9', token: 'bbb', title: 'Dansei shikkaku' }]),
    );

    expect(match?.matchedBy).toBe('title');
    expect(match?.record.gid).toBe('9');
  });

  it('returns null when nothing matches', () => {
    expect(matchIndexRecord(unit('/lib/unknown_work', 'unknown_work'), ehRecords)).toBeNull();
  });
});

describe('loadSiblingIndexes', () => {
  it('loads existing indexes in priority order and skips broken files', async () => {
    const fs = createMemoryFs({
      '/lib/plan.json': JSON.stringify([{ gid: '1', token: 'aaa', slug: 'one', title: 'One' }]),
      '/lib/eh.json': '{ not json',
      '/lib/wn.json': JSON.stringify([{ aid: '2', title: 'Two' }]),
    });

    const records = await loadSiblingIndexes(fs, '/lib');

    expect(records.map((record) => record.source)).toEqual(['plan', 'wn']);
    expect(records.map((record) => record.title)).toEqual(['One', 'Two']);
  });
});
