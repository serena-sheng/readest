import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { arrangeSeriesAdjacent, buildDisplayTitles, parseSeriesOrder } from '@/utils/series';

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'h',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('parseSeriesOrder', () => {
  it.each([
    ['作品 第2巻', 2, '作品'],
    ['作品 第２卷', 2, '作品'],
    ['作品 第2話', 2, '作品'],
    ['作品 Vol.3', 3, '作品'],
    ['作品 part 4', 4, '作品'],
    ['作品２', 2, '作品'],
    ['作品②', 2, '作品'],
    ['作品（5）', 5, '作品'],
    ['作品 2nd', 2, '作品'],
    ['作品 上', 1, '作品'],
    ['作品 下', 3, '作品'],
    ['作品 前篇', 1, '作品'],
    ['作品 後篇', 2, '作品'],
  ])('reads the order out of %s', (raw, index, title) => {
    const parsed = parseSeriesOrder(raw);
    expect(parsed.seriesIndex).toBe(index);
    expect(parsed.title).toBe(title);
    expect(parsed.series).toBe(title);
  });

  it('leaves a title that is only a number alone', () => {
    expect(parseSeriesOrder('1984')).toEqual({ title: '1984' });
  });

  it('leaves a title without a marker alone', () => {
    expect(parseSeriesOrder('普通书名')).toEqual({ title: '普通书名' });
  });
});

describe('arrangeSeriesAdjacent', () => {
  it('keeps books of the same series together in ascending order', () => {
    const books = [
      makeBook({
        hash: 'solo',
        title: 'Solo',
        metadata: { title: 'Solo', author: '', language: '' },
      }),
      makeBook({
        hash: 'v3',
        title: 'B',
        metadata: {
          title: 'Title',
          author: 'Author',
          language: '',
          series: 'Saga',
          seriesIndex: 3,
        },
      }),
      makeBook({
        hash: 'other',
        title: 'Other',
        metadata: {
          title: 'Title',
          author: 'Author',
          language: '',
          series: 'Other',
          seriesIndex: 1,
        },
      }),
      makeBook({
        hash: 'v1',
        title: 'A',
        metadata: {
          title: 'Title',
          author: 'Author',
          language: '',
          series: 'Saga',
          seriesIndex: 1,
        },
      }),
      makeBook({
        hash: 'v2',
        title: 'C',
        metadata: {
          title: 'Title',
          author: 'Author',
          language: '',
          series: 'Saga',
          seriesIndex: 2,
        },
      }),
    ];

    const arranged = arrangeSeriesAdjacent(books).map((book) => book.hash);

    expect(arranged).toEqual(['solo', 'v1', 'v2', 'v3', 'other']);
  });
});

describe('buildDisplayTitles', () => {
  it('numbers duplicate titles by createdAt without touching the stored title', () => {
    const books = [
      makeBook({ hash: 'c', title: '同名', createdAt: 3 }),
      makeBook({ hash: 'a', title: '同名', createdAt: 1 }),
      makeBook({ hash: 'b', title: '同名', createdAt: 2 }),
      makeBook({ hash: 'unique', title: '唯一', createdAt: 4 }),
    ];

    const titles = buildDisplayTitles(books);

    expect(titles.get('a')).toBe('同名');
    expect(titles.get('b')).toBe('同名（2）');
    expect(titles.get('c')).toBe('同名（3）');
    expect(titles.has('unique')).toBe(false);
    expect(books[0]!.title).toBe('同名');
  });

  it('does not number a group that already carries series indexes', () => {
    const books = [
      makeBook({
        hash: 'a',
        title: '同名',
        metadata: { title: 'Title', author: 'Author', language: '', series: 'S', seriesIndex: 1 },
      }),
      makeBook({
        hash: 'b',
        title: '同名',
        metadata: { title: 'Title', author: 'Author', language: '', series: 'S', seriesIndex: 2 },
      }),
    ];

    expect(buildDisplayTitles(books).size).toBe(0);
  });
});
