/**
 * Matches scanned units against the scrape indexes that live beside a library
 * folder (`plan.json`, `eh.json`, `list.json`, `wn.json`).
 *
 * Downloads are named by human slugs (`wn_322395`, `dansei_en`), so an index
 * hit is often the only link between a folder on disk and its gallery id.
 */

import { basename, joinPath, stripExtension } from './fs';
import type { ImportUnit, MangaFs } from './types';

/** Which sibling index a record was parsed from. */
export type IndexSource = 'plan' | 'eh' | 'list' | 'wn';

/** Why a record matched; mirrors the documented priority order. */
export type IndexMatchReason = 'slug' | 'gid-token' | 'aid' | 'title';

/** Normalized index row, independent of the file it came from. */
export interface IndexRecord {
  source: IndexSource;
  gid?: string;
  token?: string;
  aid?: string;
  /** Relative detail-page path from wnacg indexes (`/photos-index-aid-N.html`). */
  href?: string;
  slug?: string;
  title?: string;
  titleJpn?: string;
  pages?: number;
  lang?: string[];
  posted?: string;
  uploader?: string;
  thumb?: string;
  category?: string;
  tags?: string[];
  note?: string;
}

export interface IndexMatch {
  record: IndexRecord;
  matchedBy: IndexMatchReason;
}

/** Index files in priority order: `plan.json` first because it carries slugs. */
export const INDEX_FILES: readonly (readonly [IndexSource, string])[] = [
  ['plan', 'plan.json'],
  ['eh', 'eh.json'],
  ['list', 'list.json'],
  ['wn', 'wn.json'],
];

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => text(item))
    .filter((item): item is string => item !== undefined);
  return items.length > 0 ? items : undefined;
}

/**
 * Normalizes one index file's JSON into records.
 *
 * Unknown shapes (or a non-array payload) yield an empty list rather than an
 * error: indexes are user-managed scratch files and may be missing fields.
 */
export function parseIndex(source: IndexSource, raw: unknown): IndexRecord[] {
  if (!Array.isArray(raw)) return [];

  const records: IndexRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;

    const gid = text(item['gid']) ?? text(item['gallery_id']);
    const token = text(item['token']);
    const href = text(item['href']);
    const aid = text(item['aid']) ?? (href ? /photos-index-aid-(\d+)/.exec(href)?.[1] : undefined);
    const title = text(item['title']);
    const slug = text(item['slug']);
    if (!gid && !aid && !title && !slug) continue;

    const record: IndexRecord = { source };
    if (gid) record.gid = gid;
    if (token) record.token = token;
    if (aid) record.aid = aid;
    if (href) record.href = href;
    if (slug) record.slug = slug;
    if (title) record.title = title;

    const titleJpn = text(item['title_jpn']);
    if (titleJpn) record.titleJpn = titleJpn;

    const pages = positiveNumber(item['pages']) ?? positiveNumber(item['filecount']);
    if (pages !== undefined) record.pages = pages;

    const lang = textList(item['lang']) ?? textList(item['language']);
    if (lang) record.lang = lang;

    const posted = text(item['posted']);
    if (posted) record.posted = posted;

    const uploader = text(item['uploader']);
    if (uploader) record.uploader = uploader;

    const thumb = text(item['thumb']) ?? text(item['cover']);
    if (thumb) record.thumb = thumb;

    const category = text(item['category']) ?? text(item['cat']);
    if (category) record.category = category;

    const tags = textList(item['tags']);
    if (tags) record.tags = tags;

    const note = text(item['note']);
    if (note) record.note = note;

    records.push(record);
  }

  return records;
}

/**
 * Loads every index file that exists beside `dirPath`, in priority order.
 *
 * Missing or malformed files are skipped — the import falls back to later
 * metadata sources instead of failing.
 */
export async function loadSiblingIndexes(fs: MangaFs, dirPath: string): Promise<IndexRecord[]> {
  const records: IndexRecord[] = [];
  for (const [source, fileName] of INDEX_FILES) {
    try {
      const raw: unknown = JSON.parse(await fs.readTextFile(joinPath(dirPath, fileName)));
      records.push(...parseIndex(source, raw));
    } catch {
      // Optional file: absent, unreadable, or not valid JSON.
    }
  }
  return records;
}

/**
 * Finds the best index record for `unit`.
 *
 * Priority (first rule with a hit wins):
 *   1. folder/archive name equals the record's `slug`
 *   2. the unit path or one of `entryNames` contains both the record's `gid`
 *      and `token` (downloaded folders often carry the id inside, e.g. a
 *      subfolder or cover file named `4264785_97f2cdbfa3`)
 *   3. the unit name references a wnacg `aid` (`wn_322395` or `322395`)
 *   4. the unit title equals the record title (whitespace-tolerant)
 */
export function matchIndexRecord(
  unit: ImportUnit,
  records: readonly IndexRecord[],
  entryNames: readonly string[] = [],
): IndexMatch | null {
  const name = unit.kind === 'archive' ? stripExtension(basename(unit.path)) : basename(unit.path);
  const title = unit.title ?? name;
  const searchText = [unit.path, ...entryNames].join('\n');

  for (const record of records) {
    if (record.slug && record.slug === name) return { record, matchedBy: 'slug' };
  }

  for (const record of records) {
    if (
      record.gid &&
      record.token &&
      searchText.includes(record.gid) &&
      searchText.includes(record.token)
    ) {
      return { record, matchedBy: 'gid-token' };
    }
  }

  for (const record of records) {
    if (!record.aid) continue;
    if (name === record.aid || name === `wn_${record.aid}` || name.endsWith(`_${record.aid}`)) {
      return { record, matchedBy: 'aid' };
    }
  }

  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  for (const record of records) {
    if (!record.title) continue;
    if (record.title.replace(/\s+/g, ' ').trim() === normalizedTitle) {
      return { record, matchedBy: 'title' };
    }
  }

  return null;
}

/**
 * Filesystem-aware match for folder units: also searches the folder's entry
 * names, so a `gid`/`token` that only appears inside the folder still matches.
 * Archives are not descended into (their names are page numbers); unreadable
 * folders fall back to the path-only rules.
 */
export async function matchIndexForUnit(
  unit: ImportUnit,
  records: readonly IndexRecord[],
  fs: MangaFs,
): Promise<IndexMatch | null> {
  if (unit.kind !== 'folder') return matchIndexRecord(unit, records);
  try {
    const entries = await fs.readDir(unit.path);
    return matchIndexRecord(
      unit,
      records,
      entries.map((entry) => entry.name),
    );
  } catch {
    return matchIndexRecord(unit, records);
  }
}
