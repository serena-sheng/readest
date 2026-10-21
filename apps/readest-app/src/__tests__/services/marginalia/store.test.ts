import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarginNote } from '@/services/marginalia/store';

const BOOK = 'book-margin';
const STORAGE_KEY = `readest-marginalia:${BOOK}`;

const note = (overrides: Partial<MarginNote> = {}): MarginNote => ({
  id: 'note-1',
  anchorCfi: 'epubcfi(/6/2!/4/2/1:0)',
  kind: 'translation',
  text: '你好',
  at: 1,
  ...overrides,
});

// Node 26 ships an unusable global `localStorage`; install a real in-memory
// Storage on the jsdom window so the module under test exercises its actual
// persistence path.
const createStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
};

let storage: Storage;

// Each test starts from a fresh module so the in-memory cache cannot stand in
// for what localStorage actually holds.
const loadStore = () => import('@/services/marginalia/store');

beforeEach(() => {
  storage = createStorage();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  vi.resetModules();
});

describe('margin note store', () => {
  it('adds, lists and removes notes', async () => {
    const store = await loadStore();
    store.add(BOOK, note({ id: 'a' }));
    store.add(BOOK, note({ id: 'b', anchorCfi: 'epubcfi(/6/2!/4/4/1:0)', at: 2 }));

    expect(store.list(BOOK).map((entry) => entry.id)).toEqual(['a', 'b']);

    store.remove(BOOK, 'a');
    expect(store.list(BOOK).map((entry) => entry.id)).toEqual(['b']);
  });

  it('keeps books isolated from one another', async () => {
    const store = await loadStore();
    store.add('book-a', note({ id: 'a' }));
    store.add('book-b', note({ id: 'b', text: 'bonjour' }));

    expect(store.list('book-a').map((entry) => entry.text)).toEqual(['你好']);
    expect(store.list('book-b').map((entry) => entry.text)).toEqual(['bonjour']);

    store.clear('book-a');
    expect(store.list('book-a')).toEqual([]);
    expect(store.list('book-b')).toHaveLength(1);
  });

  it('reads notes back from localStorage after a reload', async () => {
    const first = await loadStore();
    first.add(BOOK, note({ id: 'persisted' }));

    // Simulate a new page load: new module, same localStorage.
    vi.resetModules();
    const second = await loadStore();

    expect(second.list(BOOK)).toEqual([note({ id: 'persisted' })]);
  });

  it('degrades malformed or foreign data to an empty margin', async () => {
    storage.setItem(STORAGE_KEY, '{not json');
    let store = await loadStore();
    expect(store.list(BOOK)).toEqual([]);

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'ok', anchorCfi: 'cfi', kind: 'note', text: 'x', at: 1 }, { id: 7 }]),
    );
    vi.resetModules();
    store = await loadStore();
    expect(store.list(BOOK).map((entry) => entry.id)).toEqual(['ok']);
  });

  it('clears every note and its stored copy', async () => {
    const store = await loadStore();
    store.add(BOOK, note({ id: 'a' }));
    store.add(BOOK, note({ id: 'b', anchorCfi: 'other' }));

    store.clear(BOOK);

    expect(store.list(BOOK)).toEqual([]);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('replaces a note of the same kind at the same anchor', async () => {
    const store = await loadStore();
    store.add(BOOK, note({ id: 'first', text: '版本一', at: 1 }));
    store.add(BOOK, note({ id: 'second', text: '版本二', at: 2 }));

    expect(store.list(BOOK)).toHaveLength(1);
    expect(store.list(BOOK)[0]!.text).toBe('版本二');
  });

  it('keeps different kinds at the same anchor', async () => {
    const store = await loadStore();
    store.add(BOOK, note({ id: 'translation', kind: 'translation' }));
    store.add(BOOK, note({ id: 'note', kind: 'note', text: '自己的想法' }));

    expect(store.list(BOOK).map((entry) => entry.kind)).toEqual(['translation', 'note']);
  });
});
