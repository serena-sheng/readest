import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearBook,
  getMany,
  getTranslation,
  hashTranslationText,
  makeTranslationKey,
  pruneOlderThan,
  resetTranslationCacheForTests,
  setTranslation,
} from '@/services/translators/translationCache';

// ---------------------------------------------------------------------------
// Minimal IndexedDB fake: only the surface translationCache uses (open,
// object store get/put, cursor and transaction completion).
// ---------------------------------------------------------------------------

class FakeRequest<T = unknown> {
  result: T | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeObjectStore {
  data = new Map<string, unknown>();
  transaction!: FakeTransaction;

  get(key: string) {
    const request = new FakeRequest<unknown>();
    const transaction = this.transaction;
    transaction.begin();
    queueMicrotask(() => {
      request.result = this.data.get(key) ?? null;
      request.onsuccess?.();
      transaction.end();
    });
    return request;
  }

  put(value: unknown, key: string) {
    this.data.set(key, value);
    const request = new FakeRequest();
    const transaction = this.transaction;
    transaction.begin();
    queueMicrotask(() => {
      request.onsuccess?.();
      transaction.end();
    });
    return request;
  }

  openCursor() {
    const request = new FakeRequest<{
      key: string;
      value: unknown;
      delete: () => void;
      continue: () => void;
    }>();
    const transaction = this.transaction;
    transaction.begin();
    const entries = Array.from(this.data.entries());
    let index = 0;
    const step = () => {
      if (index >= entries.length) {
        request.result = null;
        request.onsuccess?.();
        transaction.end();
        return;
      }
      const [key, value] = entries[index++]!;
      request.result = {
        key,
        value,
        delete: () => this.data.delete(key),
        continue: () => queueMicrotask(step),
      };
      request.onsuccess?.();
    };
    queueMicrotask(step);
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private pending = 0;

  constructor(private readonly store: FakeObjectStore) {
    store.transaction = this;
  }

  begin() {
    this.pending += 1;
  }

  end() {
    this.pending -= 1;
    if (this.pending === 0) {
      queueMicrotask(() => this.oncomplete?.());
    }
  }

  objectStore() {
    return this.store;
  }
}

class FakeDatabase {
  store = new FakeObjectStore();
  objectStoreNames = { contains: (name: string) => name === 'entries' };

  transaction() {
    return new FakeTransaction(this.store);
  }

  close() {}
}

const createFakeIndexedDB = () => {
  const database = new FakeDatabase();
  const factory = {
    open: () => {
      const request = new FakeRequest<FakeDatabase>();
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory, database };
};

beforeEach(() => {
  resetTranslationCacheForTests();
});

afterEach(() => {
  resetTranslationCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('translationCache', () => {
  test('stores and reads a translation through IndexedDB', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const key = makeTranslationKey('book-a', 'EN', 'deepl|', 'hello world');

    await setTranslation(key, '你好，世界');
    expect(await getTranslation(key)).toBe('你好，世界');
    expect(await getTranslation(makeTranslationKey('book-a', 'EN', 'deepl|', 'other'))).toBeNull();
  });

  test('survives a cold memory and reads back from IndexedDB', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const key = makeTranslationKey('book-a', 'EN', 'deepl|', 'persisted paragraph');
    await setTranslation(key, '已持久化');

    // Simulate reopening the book: the process survives, the LRU does not.
    resetTranslationCacheForTests();

    expect(await getTranslation(key)).toBe('已持久化');
  });

  test('getMany returns only the keys that hit', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const hitA = makeTranslationKey('book-a', 'EN', 'deepl|', 'one');
    const hitB = makeTranslationKey('book-a', 'EN', 'deepl|', 'two');
    const miss = makeTranslationKey('book-a', 'EN', 'deepl|', 'three');
    await setTranslation(hitA, 'A');
    await setTranslation(hitB, 'B');

    const hits = await getMany([hitA, hitB, miss]);

    expect(hits.size).toBe(2);
    expect(hits.get(hitA)).toBe('A');
    expect(hits.get(hitB)).toBe('B');
    expect(hits.has(miss)).toBe(false);
  });

  test('the cache key changes with book, language, style or text', () => {
    const base = makeTranslationKey('book-a', 'EN', 'deepl|', 'text');

    expect(makeTranslationKey('book-b', 'EN', 'deepl|', 'text')).not.toBe(base);
    expect(makeTranslationKey('book-a', 'ZH', 'deepl|', 'text')).not.toBe(base);
    expect(makeTranslationKey('book-a', 'EN', 'azure|', 'text')).not.toBe(base);
    expect(makeTranslationKey('book-a', 'EN', 'deepl|', 'text ')).not.toBe(base);
    expect(base).toMatch(/^book-a\|EN\|deepl\|\|[0-9a-f]{8}$/);
  });

  test('hashTranslationText is deterministic and dependency free', () => {
    expect(hashTranslationText('same text')).toBe(hashTranslationText('same text'));
    expect(hashTranslationText('same text')).not.toBe(hashTranslationText('same texT'));
    expect(hashTranslationText('')).toMatch(/^[0-9a-f]{8}$/);
  });

  test('evicts the least recently used entry after 200 translations', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const first = makeTranslationKey('book-a', 'EN', 'deepl|', 'paragraph 0');
    const last = makeTranslationKey('book-a', 'EN', 'deepl|', 'paragraph 200');

    for (let index = 0; index <= 200; index++) {
      await setTranslation(
        makeTranslationKey('book-a', 'EN', 'deepl|', `paragraph ${index}`),
        `translation ${index}`,
      );
    }

    expect(await getTranslation(first)).toBeNull();
    expect(await getTranslation(last)).toBe('translation 200');
  });

  test('falls back to memory when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const key = makeTranslationKey('book-a', 'EN', 'deepl|', 'offline');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setTranslation(key, '内存')).resolves.toBeUndefined();
    expect(await getTranslation(key)).toBe('内存');
    expect((await getMany([key])).get(key)).toBe('内存');
    expect(warn).not.toHaveBeenCalled();
  });

  test('clearBook drops only entries of that book', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const bookA = makeTranslationKey('book-a', 'EN', 'deepl|', 'a');
    const bookB = makeTranslationKey('book-b', 'EN', 'deepl|', 'b');
    await setTranslation(bookA, 'A');
    await setTranslation(bookB, 'B');

    expect(await clearBook('book-a')).toBeGreaterThanOrEqual(1);
    expect(await getTranslation(bookA)).toBeNull();
    expect(await getTranslation(bookB)).toBe('B');
  });

  test('pruneOlderThan removes entries past their retention window', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const now = Date.now();
    const stale = makeTranslationKey('book-a', 'EN', 'deepl|', 'stale');
    const fresh = makeTranslationKey('book-a', 'EN', 'deepl|', 'fresh');
    vi.spyOn(Date, 'now').mockReturnValue(now - 100 * 24 * 60 * 60 * 1000);
    await setTranslation(stale, 'old');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await setTranslation(fresh, 'new');

    expect(await pruneOlderThan(90)).toBeGreaterThanOrEqual(1);
    expect(await getTranslation(stale)).toBeNull();
    expect(await getTranslation(fresh)).toBe('new');
  });
});
