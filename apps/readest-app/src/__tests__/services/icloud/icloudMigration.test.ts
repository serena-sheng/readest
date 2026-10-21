import { describe, expect, it, vi } from 'vitest';
import type { AppService, FileItem } from '@/types/system';
import type { IcloudPaths } from '@/services/icloud/icloudLibrary';
import { migrateLocalBooksToIcloud } from '@/services/icloud/icloudMigration';

const LOCAL_BOOKS = '/app/Readest/Books';
const PATHS: IcloudPaths = {
  root: '/icloud/Readest',
  books: '/icloud/Readest/Books',
  manifest: '/icloud/Readest/library.json',
};

interface MemoryStore {
  files: Map<string, string>;
  dirs: Set<string>;
  links: Map<string, string>;
  failCopyFrom: Set<string>;
}

const createMemoryFs = (initial: { files?: Record<string, string>; dirs?: string[] } = {}) => {
  const store: MemoryStore = {
    files: new Map(Object.entries(initial.files ?? {})),
    dirs: new Set([
      PATHS.root,
      PATHS.books,
      '/app',
      '/app/Readest',
      LOCAL_BOOKS,
      ...(initial.dirs ?? []),
    ]),
    links: new Map(),
    failCopyFrom: new Set(),
  };

  const isUnder = (path: string, dir: string) => path.startsWith(`${dir}/`);

  const appService = {
    osPlatform: 'macos',
    isMacOSApp: true,
    exists: vi.fn(async (path: string) => {
      if (store.links.has(path)) return true;
      if (store.files.has(path) || store.dirs.has(path)) return true;
      for (const file of store.files.keys()) {
        if (isUnder(file, path)) return true;
      }
      return false;
    }),
    isDirectory: vi.fn(async (path: string) => {
      if (store.dirs.has(path)) return true;
      const target = store.links.get(path);
      if (target !== undefined) return store.dirs.has(target);
      for (const file of store.files.keys()) {
        if (isUnder(file, path)) return true;
      }
      return false;
    }),
    createDir: vi.fn(async (path: string) => {
      const segments = path.split('/');
      for (let i = 1; i <= segments.length; i += 1) {
        const partial = segments.slice(0, i).join('/');
        if (partial) store.dirs.add(partial);
      }
    }),
    readDirectory: vi.fn(async (path: string): Promise<FileItem[]> => {
      const prefix = `${path.replace(/\/+$/, '')}/`;
      const names = new Set<string>();
      for (const file of store.files.keys()) {
        if (isUnder(file, path)) {
          const name = file.slice(prefix.length).split('/')[0];
          if (name) names.add(name);
        }
      }
      for (const dir of store.dirs) {
        if (isUnder(dir, path)) {
          const name = dir.slice(prefix.length).split('/')[0];
          if (name) names.add(name);
        }
      }
      return [...names].map((name) => ({
        path: name,
        size: store.files.get(prefix + name)?.length ?? 0,
      }));
    }),
    copyFile: vi.fn(async (src: string, _srcBase: string, dst: string) => {
      if (store.failCopyFrom.has(src)) throw new Error(`copy failed: ${src}`);
      const content = store.files.get(src);
      if (content === undefined) throw new Error(`missing source: ${src}`);
      store.files.set(dst, content);
    }),
    deleteFile: vi.fn(async (path: string) => {
      store.files.delete(path);
    }),
    deleteDir: vi.fn(async (path: string) => {
      for (const file of [...store.files.keys()]) {
        if (isUnder(file, path) || file === path) store.files.delete(file);
      }
      for (const dir of [...store.dirs]) {
        if (isUnder(dir, path) || dir === path) store.dirs.delete(dir);
      }
      store.links.delete(path);
    }),
    ensureSymlink: vi.fn(async (target: string, link: string) => {
      const existing = store.links.get(link);
      if (existing === target) return;
      if (store.dirs.has(link) || store.files.has(link)) {
        throw new Error(`${link} exists and is not a symbolic link`);
      }
      store.links.set(link, target);
    }),
  } as unknown as AppService;

  return { appService, store };
};

const localFiles = {
  [`${LOCAL_BOOKS}/library.json`]: '[{"hash":"a"}]',
  [`${LOCAL_BOOKS}/a/book.epub`]: 'epub-a',
  [`${LOCAL_BOOKS}/a/cover.png`]: 'cover-a',
  [`${LOCAL_BOOKS}/b/book.epub`]: 'epub-b',
};

describe('migrateLocalBooksToIcloud', () => {
  it('moves local books into iCloud Drive', async () => {
    const { appService, store } = createMemoryFs({ files: localFiles });
    const result = await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(result.failed).toEqual([]);
    expect(result.linked).toBe(true);
    expect(result.moved).toBe(3);
    expect(result.merged).toBe(0);
    expect(store.files.get(`${PATHS.books}/a/book.epub`)).toBe('epub-a');
    expect(store.files.get(`${PATHS.books}/b/book.epub`)).toBe('epub-b');
  });

  it('replaces the local directory with a symlink to iCloud', async () => {
    const { appService, store } = createMemoryFs({ files: localFiles });
    await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(store.dirs.has(LOCAL_BOOKS)).toBe(false);
    expect(store.links.get(LOCAL_BOOKS)).toBe(PATHS.books);
    expect(appService.ensureSymlink).toHaveBeenCalledWith(PATHS.books, LOCAL_BOOKS);
  });

  it('keeps the local copy and creates no link when a file fails to move', async () => {
    const { appService, store } = createMemoryFs({ files: localFiles });
    store.failCopyFrom.add(`${LOCAL_BOOKS}/b/book.epub`);

    const result = await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.linked).toBe(false);
    expect(store.links.has(LOCAL_BOOKS)).toBe(false);
    expect(store.files.get(`${LOCAL_BOOKS}/b/book.epub`)).toBe('epub-b');
    expect(store.files.get(`${LOCAL_BOOKS}/a/book.epub`)).toBe('epub-a');
    // Everything this run copied into iCloud is rolled back.
    expect(store.files.get(`${PATHS.books}/a/book.epub`)).toBeUndefined();
    expect(store.files.get(`${PATHS.books}/b/book.epub`)).toBeUndefined();
  });

  it('merges into books already present in iCloud without overwriting them', async () => {
    const { appService, store } = createMemoryFs({
      files: {
        ...localFiles,
        [`${PATHS.books}/a/cover.png`]: 'cloud-cover',
      },
    });

    const result = await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(result.linked).toBe(true);
    expect(result.merged).toBe(1);
    expect(store.files.get(`${PATHS.books}/a/cover.png`)).toBe('cloud-cover');
    expect(store.files.get(`${PATHS.books}/a/book.epub`)).toBe('epub-a');
    expect(store.files.get(`${PATHS.books}/b/book.epub`)).toBe('epub-b');
  });

  it('is idempotent when the link is already in place', async () => {
    const { appService, store } = createMemoryFs({ files: localFiles });
    await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);
    const copyCalls = vi.mocked(appService.copyFile).mock.calls.length;

    const second = await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(second).toMatchObject({ moved: 0, merged: 0, failed: [], linked: true });
    expect(vi.mocked(appService.copyFile).mock.calls.length).toBe(copyCalls);
    expect(store.links.get(LOCAL_BOOKS)).toBe(PATHS.books);
  });

  it('moves library.json along with the books', async () => {
    const { appService, store } = createMemoryFs({ files: localFiles });
    await migrateLocalBooksToIcloud(appService, PATHS, LOCAL_BOOKS);

    expect(store.files.get(`${PATHS.books}/library.json`)).toBe('[{"hash":"a"}]');
    expect(store.files.has(`${LOCAL_BOOKS}/library.json`)).toBe(false);
  });
});
