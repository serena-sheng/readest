/**
 * Persistent cache for translated manga pages.
 *
 * A page is expensive: one vision request per image, and the reader revisits
 * pages while paging back and forth. Results live in IndexedDB under a key
 * that folds in everything that changes the output — the image bytes, the
 * vision model, the target language and a revision of the glossary — so a
 * configuration change can never serve a stale translation.
 *
 * A 30-entry in-memory LRU sits in front of IndexedDB because the reader
 * re-renders the current page far more often than it opens new ones. When
 * IndexedDB is unavailable (private windows, tests) the memory layer keeps
 * working and every operation degrades silently.
 */

import { hashBytes } from './imageHash';
import type { MangaBubble, MangaPageResult } from './types';
import { normalizeBubble } from './visionPrompt';

const DB_NAME = 'readest-manga';
const DB_VERSION = 1;
const STORE_NAME = 'pages';
const MEMORY_LRU_SIZE = 30;

const memory = new Map<string, MangaPageResult>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

/** `imageHash|model|targetLang|glossaryRevision`, as documented by the cache. */
export function makeMangaCacheKey(
  imageHash: string,
  model: string,
  targetLang: string,
  glossaryRevisionValue: string,
): string {
  return `${imageHash}|${model}|${targetLang}|${glossaryRevisionValue}`;
}

/**
 * A stable revision for the reader's glossary. Terms are sorted by code point
 * so the same glossary yields the same revision on every device, and the
 * revision is a hash so the cache key does not grow with the glossary.
 */
export function glossaryRevision(glossary?: Record<string, string>): string {
  const entries = Object.entries(glossary ?? {})
    .map(([term, translation]) => [term.trim(), translation.trim()] as const)
    .filter(([term]) => term.length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return hashBytes(new TextEncoder().encode(JSON.stringify(entries)));
}

/** Validates a stored value; a hand-edited or older record is ignored. */
const normalizeResult = (value: unknown): MangaPageResult | null => {
  if (!value || typeof value !== 'object') return null;
  const result = value as Partial<MangaPageResult>;
  if (
    typeof result.width !== 'number' ||
    !Number.isFinite(result.width) ||
    result.width <= 0 ||
    typeof result.height !== 'number' ||
    !Number.isFinite(result.height) ||
    result.height <= 0 ||
    !Array.isArray(result.bubbles)
  ) {
    return null;
  }
  return {
    width: result.width,
    height: result.height,
    bubbles: result.bubbles
      .map(normalizeBubble)
      .filter((bubble): bubble is MangaBubble => bubble !== null),
  };
};

const memoryGet = (key: string): MangaPageResult | null => {
  const value = memory.get(key);
  if (!value) return null;
  // Refresh recency: Map iterates in insertion order, and eviction takes the
  // first key.
  memory.delete(key);
  memory.set(key, value);
  return value;
};

const memorySet = (key: string, value: MangaPageResult) => {
  memory.delete(key);
  memory.set(key, value);
  while (memory.size > MEMORY_LRU_SIZE) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
};

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (databasePromise) return databasePromise;

  const { promise, resolve } = Promise.withResolvers<IDBDatabase | null>();
  databasePromise = promise;

  let factory: IDBFactory | null = null;
  try {
    factory = typeof indexedDB !== 'undefined' ? indexedDB : null;
  } catch {
    factory = null;
  }
  if (!factory) {
    resolve(null);
    return promise;
  }

  try {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }

  return promise;
};

export async function getMangaPage(key: string): Promise<MangaPageResult | null> {
  const cached = memoryGet(key);
  if (cached) return cached;

  const database = await openDatabase();
  if (!database) return null;

  const { promise, resolve } = Promise.withResolvers<MangaPageResult | null>();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(normalizeResult(request.result));
    request.onerror = () => resolve(null);
  } catch {
    resolve(null);
  }

  const result = await promise;
  if (result) memorySet(key, result);
  return result;
}

export async function setMangaPage(key: string, result: MangaPageResult): Promise<void> {
  memorySet(key, result);

  const database = await openDatabase();
  if (!database) return;

  const { promise, resolve } = Promise.withResolvers<void>();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(result, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  } catch {
    resolve();
  }
  await promise;
}

/**
 * Test-only: forget the memory layer and the open database handle so a test
 * can swap `indexedDB` between cases. Not part of the runtime API.
 */
export function resetMangaCacheForTests() {
  memory.clear();
  const pending = databasePromise;
  databasePromise = null;
  void pending?.then((database) => database?.close()).catch(() => {});
}
