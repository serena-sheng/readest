import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMangaPage,
  glossaryRevision,
  makeMangaCacheKey,
  resetMangaCacheForTests,
  setMangaPage,
} from '@/services/manga/mangaCache';
import type { MangaPageResult } from '@/services/manga/types';

const result = (dst: string): MangaPageResult => ({
  width: 100,
  height: 200,
  bubbles: [{ box: [10, 20, 50, 100], src: '原文', dst, vertical: false }],
});

// ---------------------------------------------------------------------------
// Minimal IndexedDB fake: the surface mangaCache uses (open, store get/put,
// transaction completion). Same shape as the translationCache test fake.
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
    if (this.pending === 0) queueMicrotask(() => this.oncomplete?.());
  }

  objectStore() {
    return this.store;
  }
}

class FakeDatabase {
  store = new FakeObjectStore();
  objectStoreNames = { contains: (name: string) => name === 'pages' };

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
  resetMangaCacheForTests();
});

afterEach(() => {
  resetMangaCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mangaCache', () => {
  it('stores and reads a page result through IndexedDB', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const key = makeMangaCacheKey('img-1', 'vision-1', 'zh-Hans', 'rev');

    await setMangaPage(key, result('你好'));

    expect(await getMangaPage(key)).toEqual(result('你好'));
    expect(await getMangaPage(makeMangaCacheKey('img-1', 'vision-1', 'zh-Hans', 'other'))).toBeNull();
  });

  it('survives a cold memory layer by reading back from IndexedDB', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDB().factory as unknown as IDBFactory);
    const key = makeMangaCacheKey('img-2', 'vision-1', 'zh-Hans', 'rev');
    await setMangaPage(key, result('持久化'));

    resetMangaCacheForTests();

    expect(await getMangaPage(key)).toEqual(result('持久化'));
  });

  it('builds the documented composite key', () => {
    expect(makeMangaCacheKey('abcd1234', 'vision-1', 'zh-Hans', 'rev-1')).toBe(
      'abcd1234|vision-1|zh-Hans|rev-1',
    );
  });

  it('hashes the glossary order-independently and changes with its content', () => {
    const left = glossaryRevision({ 猫: '咪咪', 犬: '狗狗' });
    const right = glossaryRevision({ 犬: '狗狗', 猫: '咪咪' });

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{8}$/);
    expect(glossaryRevision({ 猫: '咪咪' })).not.toBe(left);
    expect(glossaryRevision()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('evicts the least recently used entry after 30 pages', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const first = makeMangaCacheKey('img-0', 'vision-1', 'zh-Hans', 'rev');
    const last = makeMangaCacheKey('img-30', 'vision-1', 'zh-Hans', 'rev');

    for (let index = 0; index <= 30; index++) {
      await setMangaPage(
        makeMangaCacheKey(`img-${index}`, 'vision-1', 'zh-Hans', 'rev'),
        result(`译文 ${index}`),
      );
    }

    expect(await getMangaPage(first)).toBeNull();
    expect(await getMangaPage(last)).toEqual(result('译文 30'));
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const key = makeMangaCacheKey('img-3', 'vision-1', 'zh-Hans', 'rev');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setMangaPage(key, result('内存'))).resolves.toBeUndefined();
    expect(await getMangaPage(key)).toEqual(result('内存'));
    expect(warn).not.toHaveBeenCalled();
  });
});
