/**
 * Tag helpers for E-Hentai style tags (`namespace:value`).
 *
 * `metadata.json` keeps the namespace, `ComicInfo.xml` gets the plain values
 * because Komga/Kavita only do string matching, and the tag summary is a
 * readable line built from namespaces — never a substitute for a real synopsis.
 */

const LANGUAGE_LABELS: Record<string, string> = {
  english: '英语',
  chinese: '中文',
  japanese: '日语',
  korean: '韩语',
  portuguese: '葡萄牙语',
  french: '法语',
  german: '德语',
  spanish: '西班牙语',
  russian: '俄语',
  italian: '意大利语',
  vietnamese: '越南语',
  thai: '泰语',
  indonesian: '印尼语',
  dutch: '荷兰语',
  polish: '波兰语',
  ukrainian: '乌克兰语',
  czech: '捷克语',
  hungarian: '匈牙利语',
  romanian: '罗马尼亚语',
  arabic: '阿拉伯语',
  turkish: '土耳其语',
  swedish: '瑞典语',
  tagalog: '他加禄语',
};

const PARODY_LABELS: Record<string, string> = {
  original: '原创',
};

const NAMESPACE_LABELS: Record<string, string> = {
  parody: '原作',
  group: '团体',
  artist: '画师',
  male: '男性',
  female: '女性',
  mixed: '混合',
  cosplay: 'Cosplay',
  reclass: '重分类',
  other: '其他',
};

/** Namespaces that lead the summary, in this order. */
const SUMMARY_NAMESPACE_ORDER = ['language', 'parody', 'group', 'artist', 'male', 'female'];

function parseTag(tag: string): { namespace: string; value: string } | null {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return null;
  const colon = trimmed.indexOf(':');
  if (colon < 0) return { namespace: '', value: trimmed };
  const namespace = trimmed.slice(0, colon).trim().toLowerCase();
  const value = trimmed.slice(colon + 1).trim();
  if (value.length === 0) return null;
  return { namespace, value };
}

/**
 * Groups tags by namespace. Tags without a namespace land under the empty
 * string key (`''`), keeping them distinguishable from an `other:` namespace.
 */
export function splitNamespaced(tags: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  const seen = new Set<string>();

  for (const tag of tags) {
    const parsed = parseTag(tag);
    if (!parsed) continue;
    const key = `${parsed.namespace}\u0000${parsed.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (grouped[parsed.namespace] ??= []).push(parsed.value);
  }

  return grouped;
}

/** Values for one namespace, in input order. Empty when absent. */
export function tagValues(tags: readonly string[], namespace: string): string[] {
  return splitNamespaced(tags)[namespace] ?? [];
}

/**
 * Tags for `ComicInfo.xml`: namespaces stripped, duplicates collapsed, comma
 * separated (`artist:wataya, group:trans tribune` → `wataya, trans tribune`).
 */
export function toComicInfoTags(tags: readonly string[]): string {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const parsed = parseTag(tag);
    if (!parsed) continue;
    const key = parsed.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(parsed.value);
  }
  return values.join(', ');
}

function formatNamespace(namespace: string, values: readonly string[]): string | null {
  if (values.length === 0) return null;

  if (namespace === 'language') {
    const [first, ...rest] = values;
    const localized = first ? (LANGUAGE_LABELS[first.toLowerCase()] ?? first) : '';
    return [localized, ...rest].filter((part) => part.length > 0).join(' ');
  }

  if (namespace === 'parody') {
    return values.map((value) => PARODY_LABELS[value.toLowerCase()] ?? `原作 ${value}`).join(' ');
  }

  const label = NAMESPACE_LABELS[namespace];
  return label ? `${label} ${values.join(' ')}` : `${namespace} ${values.join(' ')}`;
}

/**
 * Readable tag summary used where a site (E-Hentai) has no free-text
 * description, e.g. `英语 translated · 原创 · 团体 trans tribune · 画师 wataya`.
 * Returns `''` for no tags.
 */
export function summaryFromTags(tags: readonly string[]): string {
  const grouped = splitNamespaced(tags);
  const parts: string[] = [];

  for (const namespace of SUMMARY_NAMESPACE_ORDER) {
    const formatted = formatNamespace(namespace, grouped[namespace] ?? []);
    if (formatted) parts.push(formatted);
  }

  const remaining = Object.keys(grouped)
    .filter((namespace) => namespace !== '' && !SUMMARY_NAMESPACE_ORDER.includes(namespace))
    .sort();
  for (const namespace of remaining) {
    const formatted = formatNamespace(namespace, grouped[namespace] ?? []);
    if (formatted) parts.push(formatted);
  }

  const plain = grouped[''] ?? [];
  if (plain.length > 0) parts.push(plain.join(' '));

  return parts.join(' · ');
}
