/**
 * Fills metadata gaps from what the cover model read.
 *
 * The import priority is `manual > index/E-Hentai > cover > filename`, so this
 * layer only ever writes into fields that are still empty and never marks a
 * field as `manual` — a later index match must stay able to correct it.
 *
 * Namespaced tags carry the structured fields (`artist:`, `group:`,
 * `parody:`), the same namespaces `ComicInfo.xml` maps back to Writer/Series.
 * The model's free-form tags stay bare, so they never collide with those
 * namespaces.
 */

import { tagValues } from '../import/tags';
import type { MetadataFile } from '../import/types';
import type { CoverFields } from './coverMetadata';

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

/** Appends `value` unless an equivalent tag is already present. */
const pushTag = (tags: string[], value: string): boolean => {
  const key = value.trim().toLowerCase();
  if (!key || tags.some((tag) => tag.trim().toLowerCase() === key)) return false;
  tags.push(value.trim());
  return true;
};

/**
 * True when the cover is worth a model round-trip: a work without a title or
 * a credited artist is exactly the case the filename could not answer.
 */
export const needsCoverLookup = (metadata: MetadataFile | null): boolean =>
  !metadata?.title?.trim() ||
  !(metadata.uploader?.trim() || tagValues(metadata.tags ?? [], 'artist')[0]?.trim());

/**
 * Merges cover fields into `metadata` without overwriting anything the user
 * or an index already filled. Returns `metadata` itself when there is nothing
 * to apply.
 */
export function applyCoverFields(
  metadata: MetadataFile | null,
  cover: CoverFields | null,
): MetadataFile {
  const base: MetadataFile = metadata ?? { schema: 1 };
  if (!cover) return base;

  const manual = base.manual ?? {};
  const result: MetadataFile = { ...base, schema: 1 };
  const tags = [...(base.tags ?? [])];
  const languages = [...(base.language ?? [])];
  let tagsChanged = false;

  if (manual['title'] !== true && isEmpty(base.title) && cover.title) {
    result.title = cover.title;
  }

  if (cover.artist) {
    const hasArtistTag = tagValues(base.tags ?? [], 'artist').length > 0;
    if (manual['uploader'] !== true && isEmpty(base.uploader)) {
      result.uploader = cover.artist;
      if (manual['tags'] !== true && !hasArtistTag) {
        tagsChanged = pushTag(tags, `artist:${cover.artist}`) || tagsChanged;
      }
    }
  }
  if (cover.circle && tagValues(base.tags ?? [], 'group').length === 0 && manual['tags'] !== true) {
    tagsChanged = pushTag(tags, `group:${cover.circle}`) || tagsChanged;
  }
  // "original" means there is no source work; a `parody:original` tag would
  // only be noise in filters.
  if (
    cover.parody &&
    cover.parody.toLowerCase() !== 'original' &&
    tagValues(base.tags ?? [], 'parody').length === 0 &&
    manual['tags'] !== true
  ) {
    tagsChanged = pushTag(tags, `parody:${cover.parody}`) || tagsChanged;
  }
  if (manual['tags'] !== true) {
    for (const tag of cover.tags) tagsChanged = pushTag(tags, tag) || tagsChanged;
  }

  if (manual['language'] !== true && cover.language) {
    const key = cover.language.trim().toLowerCase();
    if (key && !languages.some((language) => language.trim().toLowerCase() === key)) {
      languages.push(cover.language.trim());
      result.language = languages;
    }
  }

  if (tagsChanged) {
    result.tags = tags;
    result['tags_source'] = 'cover';
  }

  return result;
}
