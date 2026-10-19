/**
 * Persistent, per-book translation memory.
 *
 * The reader translates paragraph by paragraph as the viewport moves. Without
 * a cache, reopening a book re-bills every already translated paragraph. This
 * module keeps finished translations in IndexedDB so the first render after
 * reopening can show them without touching the provider.
 *
 * Keys are scoped to the book, the target language and the translation style
 * (provider + prompt). Changing any of them changes the key, so entries from
 * another configuration can never be served by mistake.
 *
 * A small in-memory LRU sits in front of IndexedDB: the viewport re-queries
 * the same paragraphs many times per session, and a hit there avoids an async
 * round trip. When IndexedDB is unavailable (tests, private windows) only the
 * memory layer is used; every operation degrades silently instead of failing
 * a translation.
 */

const DB_NAME = 'readest-translations';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const MEMORY_LRU_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CachedTranslation {
  text: string;
  at: number;
}

const memory = new Map<string, CachedTranslation>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

/**
 * FNV-1a, 32 bit. Deterministic, dependency-free, and fast enough to run for
 * every visible paragraph; we only need collision resistance inside one book,
 * not cryptographic strength.
 */
export function hashTranslationText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeTranslationKey(
  bookKey: string,
  targetLang: string,
  style: string,
  text: string,
): string {
  return `${bookKey}|${targetLang}|${style}|${hashTranslationText(text)}`;
}

function normalizeEntry(value: unknown): CachedTranslation | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<CachedTranslation>;
  if (typeof entry.text !== 'string') return null;
  return { text: entry.text, at: typeof entry.at === 'number' ? entry.at : Date.now() };
}

function memoryGet(key: string): CachedTranslation | null {
  const entry = memory.get(key);
  if (!entry) return null;
  // Refresh recency: Map iterates in insertion order, and eviction takes the
  // first key.
  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

function memorySet(key: string, entry: CachedTranslation) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_LRU_SIZE) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
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
}

/**
 * Runs `run` inside one read/write transaction and resolves when it settles.
 * Failures are swallowed by design: the memory layer already holds the write
 * and a translation must never fail because storage did not cooperate.
 */
async function writeEntries(entries: Array<{ key: string; value: CachedTranslation }>) {
  const database = await openDatabase();
  if (!database || entries.length === 0) return;

  const { promise, resolve } = Promise.withResolvers<void>();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    entries.forEach(({ key, value }) => store.put(value, key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  } catch {
    resolve();
  }
  await promise;
}

export async function getTranslation(key: string): Promise<string | null> {
  const cached = memoryGet(key);
  if (cached) return cached.text;

  const database = await openDatabase();
  if (!database) return null;

  const { promise, resolve } = Promise.withResolvers<CachedTranslation | null>();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(normalizeEntry(request.result));
    request.onerror = () => resolve(null);
  } catch {
    resolve(null);
  }
  const entry = await promise;
  if (!entry) return null;
  memorySet(key, entry);
  return entry.text;
}

/**
 * Batch lookup for the rows a viewport pass is about to need. Returns only
 * the keys that hit, so callers can schedule exactly the misses.
 */
export async function getMany(keys: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    const cached = memoryGet(key);
    if (cached) {
      results.set(key, cached.text);
    } else {
      missing.push(key);
    }
  }
  if (missing.length === 0) return results;

  const database = await openDatabase();
  if (!database) return results;

  const { promise, resolve } = Promise.withResolvers<void>();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    let remaining = missing.length;
    const settle = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    for (const key of missing) {
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = normalizeEntry(request.result);
        if (entry) {
          memorySet(key, entry);
          results.set(key, entry.text);
        }
        settle();
      };
      request.onerror = settle;
    }
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  } catch {
    resolve();
  }
  await promise;

  return results;
}

export async function setTranslation(key: string, value: string): Promise<void> {
  const entry = { text: value, at: Date.now() };
  memorySet(key, entry);
  await writeEntries([{ key, value: entry }]);
}

/** Batch write, one IndexedDB transaction for the whole viewport pass. */
export async function setTranslations(
  entries: Array<{ key: string; text: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  const at = Date.now();
  writeEntries(
    entries.map(({ key, text }) => {
      const value = { text, at };
      memorySet(key, value);
      return { key, value };
    }),
  );
}

/** Drops entries older than `days` from memory and IndexedDB. */
export async function pruneOlderThan(days = 90): Promise<number> {
  const cutoff = Date.now() - days * DAY_MS;
  let removed = 0;
  for (const [key, entry] of memory) {
    if (entry.at < cutoff) {
      memory.delete(key);
      removed += 1;
    }
  }

  const database = await openDatabase();
  if (!database) return removed;

  const { promise, resolve } = Promise.withResolvers<number>();
  let deletedFromDatabase = 0;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = normalizeEntry(cursor.value);
      if (!entry || entry.at < cutoff) {
        cursor.delete();
        deletedFromDatabase += 1;
      }
      cursor.continue();
    };
    request.onerror = () => resolve(removed + deletedFromDatabase);
    transaction.oncomplete = () => resolve(removed + deletedFromDatabase);
    transaction.onerror = () => resolve(removed + deletedFromDatabase);
    transaction.onabort = () => resolve(removed + deletedFromDatabase);
  } catch {
    resolve(removed);
  }
  return promise;
}

/** Drops every cached translation belonging to one book, in this or any style. */
export async function clearBook(bookKey: string): Promise<number> {
  const prefix = `${bookKey}|`;
  let removed = 0;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      removed += 1;
    }
  }

  const database = await openDatabase();
  if (!database) return removed;

  const { promise, resolve } = Promise.withResolvers<number>();
  let deletedFromDatabase = 0;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
        cursor.delete();
        deletedFromDatabase += 1;
      }
      cursor.continue();
    };
    request.onerror = () => resolve(removed + deletedFromDatabase);
    transaction.oncomplete = () => resolve(removed + deletedFromDatabase);
    transaction.onerror = () => resolve(removed + deletedFromDatabase);
    transaction.onabort = () => resolve(removed + deletedFromDatabase);
  } catch {
    resolve(removed);
  }
  return promise;
}

/**
 * Test-only: forget the memory layer and the open database handle so a test
 * can swap `indexedDB` between cases. Not part of the runtime API.
 */
export function resetTranslationCacheForTests() {
  memory.clear();
  const pending = databasePromise;
  databasePromise = null;
  void pending?.then((database) => database?.close()).catch(() => {});
}
