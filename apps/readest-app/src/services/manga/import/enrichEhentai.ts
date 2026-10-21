/**
 * E-Hentai metadata enrichment.
 *
 * Uses the public gdata API (`POST https://e-hentai.org/api.php`), batching at
 * most 25 galleries per request and pacing *all* requests through one client
 * at least 3 seconds apart, matching the site's documented limits.
 *
 * Failures never abort an import: unreachable API, per-gallery errors, and
 * malformed rows end up in `failed` while already known fields stay untouched.
 * E-Hentai has no free-text synopsis, so galleries are tagged
 * `description_source: 'e-hentai:none'` and `description` stays empty.
 */

import { isTauriAppPlatform } from '@/services/environment';
import { joinPath } from './fs';
import { tagValues } from './tags';
import type { MetadataFile } from './types';

export const EHENTAI_API_URL = 'https://e-hentai.org/api.php';
export const EHENTAI_MAX_GIDS_PER_REQUEST = 25;
export const EHENTAI_REQUEST_INTERVAL_MS = 3000;
export const EHENTAI_COOKIES_RELATIVE_PATH = '.omp/agent/tools/ehentai/cookies.json';

/** Cookie name → value, ready for a `Cookie` header. */
export interface EhentaiCookies {
  [name: string]: string;
}

/** Minimal gallery reference needed to query the API. */
export interface EhentaiRef {
  gid: string;
  token: string;
}

export interface EhentaiGallery {
  gid: string;
  token: string;
  title: string;
  titleJpn?: string;
  category?: string;
  uploader?: string;
  posted?: string;
  rating?: number;
  pages?: number;
  tags: string[];
  thumb?: string;
}

export interface EhentaiFailure extends EhentaiRef {
  error: string;
}

export interface EhentaiFetchResult {
  galleries: EhentaiGallery[];
  failed: EhentaiFailure[];
}

export interface EhentaiClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Static cookies, or an async loader (default client reads the Tauri cookie file). */
  cookies?: EhentaiCookies | null | (() => Promise<EhentaiCookies | null>);
  intervalMs?: number;
  maxBatchSize?: number;
}

export interface EhentaiClient {
  fetchMetadata(refs: readonly EhentaiRef[]): Promise<EhentaiFetchResult>;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractGmetadata(payload: unknown): Record<string, unknown>[] | null {
  if (!payload || typeof payload !== 'object' || !('gmetadata' in payload)) return null;
  const list = payload.gmetadata;
  if (!Array.isArray(list)) return null;
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

function parseGallery(item: Record<string, unknown>): EhentaiGallery | null {
  const gid = textValue(item['gid']);
  const token = textValue(item['token']);
  const title = textValue(item['title']);
  if (!gid || !token || !title) return null;

  const gallery: EhentaiGallery = { gid, token, title, tags: [] };

  const titleJpn = textValue(item['title_jpn']);
  if (titleJpn) gallery.titleJpn = titleJpn;
  const category = textValue(item['category']);
  if (category) gallery.category = category;
  const uploader = textValue(item['uploader']);
  if (uploader) gallery.uploader = uploader;
  const posted = textValue(item['posted']);
  if (posted) gallery.posted = posted;
  const rating = numberValue(item['rating']);
  if (rating !== undefined) gallery.rating = rating;
  const pages = numberValue(item['filecount']);
  if (pages !== undefined) gallery.pages = pages;
  const thumb = textValue(item['thumb']);
  if (thumb) gallery.thumb = thumb;

  const rawTags = item['tags'];
  if (Array.isArray(rawTags)) {
    gallery.tags = rawTags
      .map((tag) => textValue(tag))
      .filter((tag): tag is string => tag !== undefined);
  }

  return gallery;
}

function dedupeRefs(refs: readonly EhentaiRef[]): EhentaiRef[] {
  const unique: EhentaiRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const gid = String(ref.gid).trim();
    const token = String(ref.token).trim();
    if (!/^\d+$/.test(gid) || token.length === 0) continue;
    const key = `${gid}:${token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ gid, token });
  }
  return unique;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the schema-1 metadata contributed by one gallery. */
export function galleryToMetadata(
  gallery: EhentaiGallery,
  fetchedAt: string = new Date().toISOString(),
): MetadataFile {
  const metadata: MetadataFile = {
    schema: 1,
    source: 'e-hentai',
    gid: Number(gallery.gid) || gallery.gid,
    token: gallery.token,
    url: `https://e-hentai.org/g/${gallery.gid}/${gallery.token}/`,
    title: gallery.title,
    tags: gallery.tags,
    language: tagValues(gallery.tags, 'language'),
    description: '',
    description_source: 'e-hentai:none',
    fetched_at: fetchedAt,
  };

  if (gallery.titleJpn) metadata.title_jpn = gallery.titleJpn;
  if (gallery.category) metadata.category = gallery.category;
  if (gallery.uploader) metadata.uploader = gallery.uploader;
  if (gallery.posted) metadata.posted = gallery.posted;
  if (gallery.rating !== undefined) metadata.rating = gallery.rating;
  if (gallery.pages !== undefined) metadata.pages = gallery.pages;
  if (gallery.thumb) metadata.thumb = gallery.thumb;

  return metadata;
}

/**
 * Parses a cookie file.
 *
 * Accepts both a `{ name: value }` map and the browser-extension/Playwright
 * shape (`[{ name, value, domain, … }]`), keeping only e-hentai/exhentai
 * cookies. Returns `null` when nothing usable is present.
 */
export function parseEhentaiCookies(raw: unknown): EhentaiCookies | null {
  const cookies: EhentaiCookies = {};

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const name = textValue(item['name']);
      const value = typeof item['value'] === 'string' ? item['value'] : undefined;
      const domain = typeof item['domain'] === 'string' ? item['domain'].toLowerCase() : '';
      if (!name || !value) continue;
      const domainMatches =
        domain.length === 0 || domain.includes('e-hentai') || domain.includes('exhentai');
      if (domainMatches) cookies[name] = value;
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) cookies[name] = value;
    }
  }

  return Object.keys(cookies).length > 0 ? cookies : null;
}

export interface EhentaiCookiesOptions {
  /** Inject a reader (tests, or callers that already have a filesystem). */
  fs?: { readTextFile(path: string): Promise<string> };
  /** Override the Tauri home directory. */
  homeDir?: string;
}

/**
 * Reads `~/.omp/agent/tools/ehentai/cookies.json`.
 *
 * On web/jsdom (and whenever the file is absent or unreadable) this resolves
 * to `null` and enrichment proceeds unauthenticated.
 */
export async function loadEhentaiCookies(
  options: EhentaiCookiesOptions = {},
): Promise<EhentaiCookies | null> {
  try {
    let reader = options.fs;
    let home = options.homeDir;

    if (!reader) {
      if (!isTauriAppPlatform()) return null;
      // Tauri-only packages are imported dynamically so the web bundle never
      // resolves them; see fs.ts for the same platform-module rationale.
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      reader = { readTextFile: (path: string) => readTextFile(path) };
    }
    if (!home) {
      const { homeDir } = await import('@tauri-apps/api/path');
      home = await homeDir();
    }

    const raw = await reader.readTextFile(joinPath(home, EHENTAI_COOKIES_RELATIVE_PATH));
    return parseEhentaiCookies(JSON.parse(raw) as unknown);
  } catch {
    // Optional cookies: no file, bad JSON, or a non-Tauri platform.
    return null;
  }
}

/**
 * Creates an E-Hentai client with its own rate-limit queue.
 *
 * All calls on one client share the 3-second interval; independent clients
 * do not, so callers should keep one client per import run.
 */
export function createEhentaiClient(options: EhentaiClientOptions = {}): EhentaiClient {
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const intervalMs = options.intervalMs ?? EHENTAI_REQUEST_INTERVAL_MS;
  const maxBatchSize = options.maxBatchSize ?? EHENTAI_MAX_GIDS_PER_REQUEST;

  let queue: Promise<void> = Promise.resolve();
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let cookiesPromise: Promise<EhentaiCookies | null> | null = null;

  const resolveCookies = async (): Promise<EhentaiCookies | null> => {
    if (!options.cookies) return null;
    if (typeof options.cookies !== 'function') return options.cookies;
    cookiesPromise ??= options.cookies();
    return cookiesPromise;
  };

  const schedule = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastRequestAt + intervalMs - now();
      if (Number.isFinite(wait) && wait > 0) await sleep(wait);
      lastRequestAt = now();
      return task();
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const requestBatch = async (
    batch: readonly EhentaiRef[],
    cookies: EhentaiCookies | null,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (cookies && Object.keys(cookies).length > 0) {
      headers['Cookie'] = Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    return fetchImpl(EHENTAI_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method: 'gdata',
        gidlist: batch.map((ref) => [Number(ref.gid), ref.token]),
        namespace: 1,
      }),
    });
  };

  return {
    async fetchMetadata(refs: readonly EhentaiRef[]): Promise<EhentaiFetchResult> {
      const unique = dedupeRefs(refs);
      const galleries: EhentaiGallery[] = [];
      const failed: EhentaiFailure[] = [];

      for (let start = 0; start < unique.length; start += maxBatchSize) {
        const batch = unique.slice(start, start + maxBatchSize);
        try {
          const cookies = await resolveCookies();
          const response = await schedule(() => requestBatch(batch, cookies));
          if (!response.ok) {
            throw new Error(`E-Hentai API HTTP ${response.status}`);
          }

          const items = extractGmetadata((await response.json()) as unknown);
          if (!items) throw new Error('E-Hentai API response is missing gmetadata');

          const seen = new Set<string>();
          for (const item of items) {
            const gid = textValue(item['gid']);
            if (!gid) continue;
            seen.add(gid);

            const error = textValue(item['error']);
            const ref = batch.find((candidate) => candidate.gid === gid);
            if (error) {
              failed.push({ gid, token: ref?.token ?? textValue(item['token']) ?? '', error });
              continue;
            }

            const gallery = parseGallery(item);
            if (gallery) galleries.push(gallery);
            else failed.push({ gid, token: ref?.token ?? '', error: 'Malformed gmetadata entry' });
          }

          for (const ref of batch) {
            if (!seen.has(ref.gid)) {
              failed.push({ ...ref, error: 'E-Hentai returned no data for this gallery' });
            }
          }
        } catch (error) {
          const message = errorMessage(error);
          for (const ref of batch) failed.push({ ...ref, error: message });
        }
      }

      return { galleries, failed };
    },
  };
}

/**
 * Default client: reads the shared cookies file lazily, once, and paces all
 * requests at the documented interval.
 */
export const ehentaiClient = createEhentaiClient({
  cookies: () => loadEhentaiCookies(),
});
