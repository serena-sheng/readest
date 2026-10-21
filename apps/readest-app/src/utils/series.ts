/**
 * Series order in book titles.
 *
 * Scraped and self-published libraries often encode a volume in the title
 * itself ("作品 第2巻", "Series Vol. 2", "②", "上"). The cleaner used by the
 * rename flow strips those markers, so the order has to be read *before*
 * cleaning and kept as `seriesIndex` metadata — otherwise every volume of a
 * series ends up with the same cleaned title.
 */

import type { Book } from '@/types/book';
import { getSeriesIndex } from '@/utils/book';

export interface ParsedSeriesOrder {
  /** 1-based volume/part number found in the title, if any. */
  seriesIndex?: number;
  /** The title with the marker removed; a standalone book has none. */
  series?: string;
  /** Title with the order marker stripped. */
  title: string;
}

const CIRCLED_NUMERALS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

const CN_NUMERALS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Parse an ASCII/full-width/Chinese numeral; `undefined` when unsupported. */
function parseOrderNumber(raw: string): number | undefined {
  const normalized = raw.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
  if (/^[0-9]+(\.[0-9]+)?$/.test(normalized)) {
    const value = parseFloat(normalized);
    return Number.isFinite(value) ? value : undefined;
  }
  if (normalized === '十') return 10;
  const tenIndex = normalized.indexOf('十');
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CN_NUMERALS[normalized.slice(0, tenIndex)];
    const ones = normalized.length > tenIndex + 1 ? CN_NUMERALS[normalized.slice(tenIndex + 1)] : 0;
    if (tens === undefined || ones === undefined) return undefined;
    return tens * 10 + ones;
  }
  return CN_NUMERALS[normalized];
}

interface SeriesMarker {
  re: RegExp;
  /** Read the 1-based order from the match; `undefined` when not a marker. */
  order: (match: RegExpMatchArray) => number | undefined;
}

const ORDER_MARKERS: SeriesMarker[] = [
  {
    re: /第\s*([0-9０-９]+|[零一二三四五六七八九十]+)\s*[巻卷話话集部冊册]/u,
    order: (m) => parseOrderNumber(m[1] ?? ''),
  },
  {
    re: /(?:volume|vol)\.?\s*([0-9０-９]+(?:\.[0-9]+)?)/iu,
    order: (m) => parseOrderNumber(m[1] ?? ''),
  },
  { re: /\bpart\s*([0-9０-９]+)/iu, order: (m) => parseOrderNumber(m[1] ?? '') },
  { re: /([0-9０-９]+)(?:st|nd|rd|th)\b/iu, order: (m) => parseOrderNumber(m[1] ?? '') },
  {
    re: /[（(]\s*([0-9０-９]+(?:\.[0-9]+)?)\s*[)）]/u,
    order: (m) => parseOrderNumber(m[1] ?? ''),
  },
  {
    re: new RegExp(`([${CIRCLED_NUMERALS}])`, 'u'),
    order: (m) => {
      const position = CIRCLED_NUMERALS.indexOf(m[1] ?? '');
      return position >= 0 ? position + 1 : undefined;
    },
  },
  { re: /(前|後|后)(篇|編|编)\s*$/u, order: (m) => (m[1] === '前' ? 1 : 2) },
  { re: /(上|中|下)\s*$/u, order: (m) => ({ 上: 1, 中: 2, 下: 3 })[m[1] ?? ''] },
  {
    re: /([0-9０-９]+(?:\.[0-9]+)?)\s*$/u,
    order: (m) => parseOrderNumber(m[1] ?? ''),
  },
];

const trimSeparators = (value: string) =>
  value
    .replace(/[（(]\s*[)）]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s·・\-—–_:：,，、]+/u, '')
    .replace(/[\s·・\-—–_:：,，、]+$/u, '')
    .trim();

/**
 * Read the volume/part order out of a title and return the title with that
 * marker removed. A title that is nothing but a number is left untouched.
 */
export function parseSeriesOrder(rawTitle: string): ParsedSeriesOrder {
  const title = (rawTitle ?? '').trim();
  if (!title) return { title: '' };

  for (const marker of ORDER_MARKERS) {
    const match = title.match(marker.re);
    if (!match || match.index === undefined) continue;
    // A number that is the whole title ("1984") is the title, not an order.
    if (title.slice(0, match.index).trim().length === 0 && match[0].trim() === title) continue;
    const order = marker.order(match);
    if (order === undefined || order < 0) continue;

    const cleaned = trimSeparators(
      title.slice(0, match.index) + title.slice(match.index + match[0].length),
    );
    if (!cleaned) continue;
    return { seriesIndex: order, series: cleaned, title: cleaned };
  }
  return { title };
}

/** Title without a volume/part marker. */
export const stripSeriesOrder = (title: string): string => parseSeriesOrder(title).title;

const seriesComparator = (a: Book, b: Book): number => {
  const aIndex = getSeriesIndex(a.metadata?.seriesIndex);
  const bIndex = getSeriesIndex(b.metadata?.seriesIndex);
  if (aIndex === undefined && bIndex === undefined) return 0;
  if (aIndex === undefined) return 1;
  if (bIndex === undefined) return -1;
  return aIndex - bIndex;
};

/**
 * Keep books of the same series next to each other: the first occurrence in
 * the (already sorted) list fixes the block position, and its siblings move
 * there in ascending series order. Books without a series keep their place.
 */
export function arrangeSeriesAdjacent<T extends Book>(books: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const book of books) {
    const series = book.metadata?.series?.trim();
    if (!series) continue;
    const bucket = buckets.get(series);
    if (bucket) bucket.push(book);
    else buckets.set(series, [book]);
  }
  if (buckets.size === 0) return books;

  const emitted = new Set<string>();
  const result: T[] = [];
  for (const book of books) {
    const series = book.metadata?.series?.trim();
    if (!series) {
      result.push(book);
      continue;
    }
    if (emitted.has(series)) continue;
    emitted.add(series);
    result.push(...buckets.get(series)!.sort(seriesComparator));
  }
  return result;
}

/**
 * Display-only titles for books that would otherwise look identical: when
 * several books share a cleaned title and none carries a series index, number
 * them by `createdAt` ("书名", "书名（2）", …). The library's `title` field is
 * never changed — a later rename would only strip the number again.
 */
export function buildDisplayTitles(books: Book[]): Map<string, string> {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    if (book.deletedAt) continue;
    const key = stripSeriesOrder(book.title).trim() || book.title;
    const group = groups.get(key);
    if (group) group.push(book);
    else groups.set(key, [book]);
  }

  const titles = new Map<string, string>();
  for (const [base, group] of groups) {
    if (group.length < 2) continue;
    if (group.some((book) => getSeriesIndex(book.metadata?.seriesIndex) !== undefined)) continue;
    const ordered = [...group].sort((a, b) => a.createdAt - b.createdAt);
    ordered.forEach((book, index) => {
      titles.set(book.hash, index === 0 ? base : `${base}（${index + 1}）`);
    });
  }
  return titles;
}
