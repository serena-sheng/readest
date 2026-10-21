/**
 * Reads and writes the two portable sidecar formats:
 *
 * - `metadata.json` (schema 1) — lossless, namespaced tags, the project's
 *   source of truth.
 * - `ComicInfo.xml` — the interchange format Komga/Kavita/Calibre read.
 *
 * Merging is field-by-field: `manual: { field: true }` entries and an existing
 * real `description_source` are never overwritten, and a repeated import of
 * unchanged data is a no-op (`changed: false`).
 *
 * Folder units get `<dir>/metadata.json` + `<dir>/ComicInfo.xml`. Archive units
 * cannot be rewritten cheaply, so they get siblings named after the archive:
 * `<name>.metadata.json` + `<name>.ComicInfo.xml`; a `ComicInfo.xml` already
 * inside the archive is still read.
 */

import { basename, dirname, joinPath, stripExtension } from './fs';
import type { IndexRecord } from './indexMatch';
import { splitNamespaced, tagValues, toComicInfoTags } from './tags';
import type {
  ImportEntryResult,
  ImportFailure,
  ImportReport,
  ImportUnit,
  MangaFs,
  MetadataFile,
} from './types';
import { readZipEntryText } from './zip';

export const METADATA_FILENAME = 'metadata.json';
export const COMICINFO_FILENAME = 'ComicInfo.xml';

const ISO_BY_LANGUAGE: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  russian: 'ru',
  italian: 'it',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
  dutch: 'nl',
  polish: 'pl',
  ukrainian: 'uk',
  czech: 'cs',
  hungarian: 'hu',
  romanian: 'ro',
  arabic: 'ar',
  turkish: 'tr',
  swedish: 'sv',
  tagalog: 'tl',
};

const LANGUAGE_BY_ISO: Record<string, string> = {
  en: 'english',
  zh: 'chinese',
  ja: 'japanese',
  ko: 'korean',
  pt: 'portuguese',
  fr: 'french',
  de: 'german',
  es: 'spanish',
  ru: 'russian',
  it: 'italian',
  vi: 'vietnamese',
  th: 'thai',
  id: 'indonesian',
  nl: 'dutch',
  pl: 'polish',
  uk: 'ukrainian',
  cs: 'czech',
  hu: 'hungarian',
  ro: 'romanian',
  ar: 'arabic',
  tr: 'turkish',
  sv: 'swedish',
  tl: 'tagalog',
};

/** Path of the unit's `metadata.json` (see module docs for archive naming). */
export function metadataPathFor(unit: ImportUnit): string {
  if (unit.kind === 'folder') return joinPath(unit.path, METADATA_FILENAME);
  return joinPath(
    dirname(unit.path),
    `${stripExtension(basename(unit.path))}.${METADATA_FILENAME}`,
  );
}

/** Path of the unit's `ComicInfo.xml` (see module docs for archive naming). */
export function comicInfoPathFor(unit: ImportUnit): string {
  if (unit.kind === 'folder') return joinPath(unit.path, COMICINFO_FILENAME);
  return joinPath(
    dirname(unit.path),
    `${stripExtension(basename(unit.path))}.${COMICINFO_FILENAME}`,
  );
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

async function readTextOrNull(fs: MangaFs, path: string): Promise<string | null> {
  try {
    return await fs.readTextFile(path);
  } catch {
    // A missing sidecar is the normal case, not an error.
    return null;
  }
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    return named[entity] ?? match;
  });
}

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (!match) return undefined;
  const value = decodeXmlEntities(match[1] ?? '').trim();
  return value.length > 0 ? value : undefined;
}

/**
 * Parses a `ComicInfo.xml` into schema-1 metadata.
 *
 * Returns `null` when the text is not a ComicInfo document. Namespaced
 * information lost in ComicInfo is reconstructed where possible: `<Series>`
 * becomes a `group:` tag and `<Writer>`/`<Penciller>` an `artist:` tag.
 */
export function parseComicInfoXml(xml: string): MetadataFile | null {
  if (!/<ComicInfo(?:\s|>)/i.test(xml)) return null;

  const metadata: MetadataFile = { schema: 1 };

  const title = readXmlTag(xml, 'Title');
  if (title) metadata.title = title;

  const series = readXmlTag(xml, 'Series');
  const writer = readXmlTag(xml, 'Writer') ?? readXmlTag(xml, 'Penciller');

  const tagList = (readXmlTag(xml, 'Tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (series) tagList.unshift(`group:${series}`);
  if (writer) tagList.unshift(`artist:${writer}`);
  const seenTags = new Set<string>();
  metadata.tags = tagList.filter((tag) => {
    const key = tag.toLowerCase();
    if (seenTags.has(key)) return false;
    seenTags.add(key);
    return true;
  });
  if (metadata.tags.length === 0) delete metadata.tags;

  const genre = readXmlTag(xml, 'Genre');
  if (genre) metadata.category = genre;

  const summary = readXmlTag(xml, 'Summary');
  if (summary) {
    metadata.description = summary;
    metadata.description_source = 'comicinfo';
  } else {
    metadata.description = '';
    metadata.description_source = 'none';
  }

  const pageCount = Number(readXmlTag(xml, 'PageCount'));
  if (Number.isFinite(pageCount) && pageCount > 0) metadata.pages = Math.round(pageCount);

  const languageIso = (readXmlTag(xml, 'LanguageISO') ?? '').split(/[,;\s]+/)[0]?.toLowerCase();
  if (languageIso) {
    const language = LANGUAGE_BY_ISO[languageIso] ?? languageIso;
    metadata.language = [language];
  }

  const web = readXmlTag(xml, 'Web');
  if (web) metadata.url = web;

  const rating = Number(readXmlTag(xml, 'Rating'));
  if (Number.isFinite(rating)) metadata.rating = rating;

  return metadata;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlElement(tag: string, value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (text.length === 0) return null;
  return `  <${tag}>${escapeXml(text)}</${tag}>`;
}

/**
 * Serializes metadata to `ComicInfo.xml`.
 *
 * `<Tags>` uses namespace-stripped values (Komga/Kavita match strings);
 * `<Series>` prefers the `group:` tag and falls back to `artist:`.
 * `<Summary>` is only emitted when a real description exists — a tag summary
 * must never masquerade as a synopsis.
 */
export function comicInfoXml(metadata: MetadataFile): string {
  const tags = metadata.tags ?? [];
  const grouped = splitNamespaced(tags);
  const series = grouped['group']?.[0] ?? grouped['artist']?.[0];
  const artist = grouped['artist']?.[0];
  const languageIso = (metadata.language ?? [])
    .map((language) => ISO_BY_LANGUAGE[language.toLowerCase()])
    .find((iso): iso is string => iso !== undefined);

  const elements = [
    xmlElement('Title', metadata.title),
    xmlElement('Series', series),
    xmlElement('Writer', artist),
    xmlElement('Penciller', artist),
    xmlElement('Genre', metadata.category),
    xmlElement('Tags', toComicInfoTags(tags)),
    xmlElement('Summary', metadata.description),
    xmlElement(
      'PageCount',
      typeof metadata.pages === 'number' ? Math.round(metadata.pages) : undefined,
    ),
    xmlElement('LanguageISO', languageIso),
    xmlElement('Web', metadata.url),
    xmlElement('Rating', typeof metadata.rating === 'number' ? metadata.rating : undefined),
  ].filter((element): element is string => element !== null);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...elements,
    '</ComicInfo>',
    '',
  ].join('\n');
}

/**
 * Merges `incoming` metadata into `existing` field by field.
 *
 * Rules:
 * - fields marked `manual: true` keep their existing non-empty value;
 * - an existing `description` whose `description_source` is not `none` is
 *   never replaced (a real synopsis outranks a scraped empty string);
 * - otherwise a non-empty incoming value wins and empty incoming values only
 *   fill existing gaps;
 * - unknown keys (newer schema fields) survive;
 * - `schema` is always 1.
 */
export function mergeMetadata(existing: MetadataFile | null, incoming: MetadataFile): MetadataFile {
  const result: Record<string, unknown> = { ...(existing ?? {}) };
  const manuallyEdited: Record<string, boolean> = {
    ...(existing?.manual ?? {}),
    ...(incoming.manual ?? {}),
  };

  const keepDescription =
    !isEmptyValue(existing?.description) &&
    typeof existing?.description_source === 'string' &&
    existing.description_source !== 'none';

  for (const key of Object.keys(incoming)) {
    if (key === 'schema' || key === 'manual' || key === 'description_source') continue;
    const incomingValue = (incoming as Record<string, unknown>)[key];
    const existingValue = existing ? (existing as Record<string, unknown>)[key] : undefined;
    if (manuallyEdited[key] === true && !isEmptyValue(existingValue)) continue;
    if (key === 'description' && keepDescription) continue;
    if (isEmptyValue(incomingValue)) {
      if (!isEmptyValue(existingValue)) result[key] = existingValue;
      continue;
    }
    result[key] = incomingValue;
  }

  result['schema'] = 1;
  if (Object.keys(manuallyEdited).length > 0) result['manual'] = manuallyEdited;
  else delete result['manual'];

  if (manuallyEdited['description_source'] !== true) {
    const source = keepDescription
      ? existing?.description_source
      : !isEmptyValue(incoming.description_source)
        ? incoming.description_source
        : (existing?.description_source ?? 'none');
    result['description_source'] = source;
  }
  if (isEmptyValue(result['description_source'])) result['description_source'] = 'none';

  return result as MetadataFile;
}

/** Reads `metadata.json` only (null when absent or not schema 1). */
export async function readMetadataFile(
  unit: ImportUnit,
  fs: MangaFs,
): Promise<MetadataFile | null> {
  const raw = await readTextOrNull(fs, metadataPathFor(unit));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record['schema'] !== undefined && record['schema'] !== 1) return null;
    // Schema 1 allows unknown fields, so the cast is the boundary contract:
    // the object is a non-array JSON object whose schema is 1.
    const metadata: MetadataFile = { ...(record as MetadataFile), schema: 1 };
    return metadata;
  } catch {
    // Corrupt sidecar: treat as absent and fall back to ComicInfo.
    return null;
  }
}

/**
 * Reads `ComicInfo.xml` for a unit: the sibling file first, then an entry
 * inside the archive.
 */
export async function readComicInfoForUnit(
  unit: ImportUnit,
  fs: MangaFs,
): Promise<MetadataFile | null> {
  const sidecar = await readTextOrNull(fs, comicInfoPathFor(unit));
  if (sidecar) {
    const parsed = parseComicInfoXml(sidecar);
    if (parsed) return parsed;
  }

  if (unit.kind === 'archive') {
    // A plain `ComicInfo.xml` in the archive's directory is a common
    // one-book-per-folder layout; the per-archive sibling above still wins.
    const shared = await readTextOrNull(fs, joinPath(dirname(unit.path), COMICINFO_FILENAME));
    if (shared) {
      const parsed = parseComicInfoXml(shared);
      if (parsed) return parsed;
    }

    try {
      const xml = await readZipEntryText(fs, unit.path, COMICINFO_FILENAME);
      if (xml) return parseComicInfoXml(xml);
    } catch {
      // Unreadable archive: no embedded ComicInfo.
      return null;
    }
  }

  return null;
}

/**
 * Reads a unit's metadata in documented priority order: `metadata.json` first,
 * then `ComicInfo.xml`.
 */
export async function readUnitMetadata(
  unit: ImportUnit,
  fs: MangaFs,
): Promise<{ metadata: MetadataFile | null; origin: 'metadata.json' | 'comicinfo' | 'none' }> {
  const metadata = await readMetadataFile(unit, fs);
  if (metadata) return { metadata, origin: 'metadata.json' };

  const comicInfo = await readComicInfoForUnit(unit, fs);
  if (comicInfo) return { metadata: comicInfo, origin: 'comicinfo' };

  return { metadata: null, origin: 'none' };
}

/**
 * Merges `incoming` into whatever is already on disk and writes both sidecars.
 *
 * `changed` reports whether any file content actually changed, which makes a
 * re-import of the same folder idempotent.
 */
export async function writeSidecars(
  unit: ImportUnit,
  incoming: MetadataFile,
  fs: MangaFs,
): Promise<{ metadata: MetadataFile; changed: boolean }> {
  const existing = await readUnitMetadata(unit, fs);
  const metadata = mergeMetadata(existing.metadata, incoming);

  const metadataPath = metadataPathFor(unit);
  const json = `${JSON.stringify(metadata, null, 2)}\n`;
  const previousJson = await readTextOrNull(fs, metadataPath);

  const comicInfoPath = comicInfoPathFor(unit);
  const xml = comicInfoXml(metadata);
  const previousXml = await readTextOrNull(fs, comicInfoPath);

  let changed = false;
  if (json !== previousJson) {
    await fs.writeTextFile(metadataPath, json);
    changed = true;
  }
  if (xml !== previousXml) {
    await fs.writeTextFile(comicInfoPath, xml);
    changed = true;
  }

  return { metadata, changed };
}

/** Converts a matched index row into schema-1 metadata fields. */
export function metadataFromIndex(record: IndexRecord): MetadataFile {
  const source = record.source === 'wn' || record.aid ? 'wnacg' : 'e-hentai';
  const metadata: MetadataFile = { schema: 1, source, description_source: 'none' };

  if (record.gid) {
    const gid = Number(record.gid);
    metadata.gid = Number.isSafeInteger(gid) ? gid : record.gid;
  }
  if (record.aid) metadata.aid = record.aid;
  if (record.token) metadata.token = record.token;
  if (record.gid && record.token) {
    metadata.url = `https://e-hentai.org/g/${record.gid}/${record.token}/`;
  } else if (record.href) {
    metadata.url = `https://www.wnacg.com${record.href}`;
  }
  if (record.title) metadata.title = record.title;
  if (record.titleJpn) metadata.title_jpn = record.titleJpn;
  if (record.category) metadata.category = record.category;
  if (record.uploader) metadata.uploader = record.uploader;
  if (record.posted) metadata.posted = record.posted;
  if (record.pages !== undefined) metadata.pages = record.pages;
  if (record.lang) metadata.language = record.lang;
  if (record.tags) {
    metadata.tags = record.tags;
    if (!metadata.language) {
      const languages = tagValues(record.tags, 'language');
      if (languages.length > 0) metadata.language = languages;
    }
  }
  if (record.thumb) metadata.thumb = record.thumb;
  if (record.note) metadata.note = record.note;

  return metadata;
}

/** Reduces per-unit outcomes into the counters shown by the import dialog. */
export function buildImportReport(results: readonly ImportEntryResult[]): ImportReport {
  let enriched = 0;
  let fromIndex = 0;
  let fromFilename = 0;
  let noDescription = 0;
  const failed: ImportFailure[] = [];

  for (const result of results) {
    if (result.origin !== 'none' && result.origin !== 'filename') enriched += 1;
    if (result.origin === 'index') fromIndex += 1;
    if (result.origin === 'filename') fromFilename += 1;
    if (!result.metadata?.description?.trim()) noDescription += 1;
    if (result.error) failed.push({ path: result.unit.path, error: result.error });
  }

  return {
    total: results.length,
    enriched,
    fromIndex,
    fromFilename,
    noDescription,
    failed,
  };
}
