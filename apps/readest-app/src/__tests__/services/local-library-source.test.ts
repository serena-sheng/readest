import { describe, test, expect, vi } from 'vitest';
import {
  downloadLibraryBook,
  fetchLibraryBooks,
  importFromLocalLibrary,
  parseLibraryBooks,
} from '@/services/librarySource';
import type { Book } from '@/types/book';

const BASE = 'http://127.0.0.1:8790';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([]),
  } as unknown as Response;
}

function blobResponse(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    blob: async () => new Blob([content]),
  } as unknown as Response;
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: `hash-${Math.random()}`,
    format: 'EPUB',
    title: 'Imported',
    author: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const remoteBook = {
  id: 7,
  title: 'Quiet Library',
  author: 'someone',
  path: '/library/Quiet Library.cbz',
  page_count: 42,
  source: 'eh',
};

describe('parseLibraryBooks', () => {
  test('keeps valid entries and drops incomplete ones', () => {
    const books = parseLibraryBooks({
      books: [
        remoteBook,
        { id: '8', title: 'String Id', path: '/library/b.epub', page_count: '3' },
        { id: null, title: 'No Id', path: '/library/c.epub' },
        { id: 9, title: '   ', path: '/library/d.epub' },
        { id: 10, title: 'No Path', path: '' },
        'not-an-object',
      ],
    });
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({ id: 7, title: 'Quiet Library', source: 'eh' });
    expect(books[1]).toMatchObject({ id: 8, title: 'String Id', page_count: 3 });
  });

  test('returns an empty list for a malformed payload', () => {
    expect(parseLibraryBooks(null)).toEqual([]);
    expect(parseLibraryBooks({ books: 'nope' })).toEqual([]);
  });
});

describe('fetchLibraryBooks', () => {
  test('requests the books endpoint and parses the response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ books: [remoteBook] }));
    const books = await fetchLibraryBooks({ baseUrl: BASE, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/library/books`);
    expect(books).toEqual([remoteBook]);
  });

  test('throws when the service rejects the request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    await expect(fetchLibraryBooks({ baseUrl: BASE, fetchImpl })).rejects.toThrow('503');
  });
});

describe('downloadLibraryBook', () => {
  test('downloads by id and names the file from the title and source extension', async () => {
    const fetchImpl = vi.fn(async () => blobResponse('cbz-bytes'));
    const file = await downloadLibraryBook(remoteBook, { baseUrl: BASE, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/library/file?id=7`);
    expect(file.name).toBe('Quiet Library.cbz');
    expect(file.type).toBe('application/vnd.comicbook+zip');
    expect(await file.text()).toBe('cbz-bytes');
  });
});

describe('importFromLocalLibrary', () => {
  test('imports new books and reports counts', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/library/books')) return jsonResponse({ books: [remoteBook] });
      return blobResponse('bytes');
    });
    const importFile = vi.fn(async (_file: File) => makeBook());

    const result = await importFromLocalLibrary({
      books: [],
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      importFile,
    });

    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      failed: 0,
      failures: [],
      skippedItems: [],
    });
    expect(importFile).toHaveBeenCalledTimes(1);
    const file = importFile.mock.calls[0]![0] as File;
    expect(file.name).toBe('Quiet Library.cbz');
  });

  test('skips books already in the library without downloading them', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ books: [remoteBook] }));
    const importFile = vi.fn(async () => makeBook());

    const result = await importFromLocalLibrary({
      books: [makeBook({ title: '  quiet   library ' })],
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      importFile,
    });

    expect(result).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(result.skippedItems).toEqual(['Quiet Library']);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // list only
    expect(importFile).not.toHaveBeenCalled();
  });

  test('one failed download does not stop the rest of the run', async () => {
    const broken = { ...remoteBook, id: 1, title: 'Broken', path: '/library/broken.pdf' };
    const good = { ...remoteBook, id: 2, title: 'Good', path: '/library/good.epub' };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/library/books')) return jsonResponse({ books: [broken, good] });
      if (url.includes('id=1')) return jsonResponse({ error: 'gone' }, 500);
      return blobResponse('ok');
    });
    const importFile = vi.fn(async () => makeBook());

    const result = await importFromLocalLibrary({
      books: [],
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      importFile,
    });

    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 1 });
    expect(result.failures).toEqual([{ title: 'Broken', error: 'Book download failed (500)' }]);
    expect(importFile).toHaveBeenCalledTimes(1);
  });

  test('counts an import that deduped to an existing book as skipped', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/library/books') ? jsonResponse({ books: [remoteBook] }) : blobResponse('x'),
    );
    const importFile = vi.fn(async () => null);

    const result = await importFromLocalLibrary({
      books: [],
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      importFile,
    });

    expect(result).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(result.skippedItems).toEqual(['Quiet Library']);
  });

  test('reports unsupported extensions without downloading', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ books: [{ ...remoteBook, path: '/library/file.mobi' }] }),
    );
    const importFile = vi.fn(async () => makeBook());

    const result = await importFromLocalLibrary({
      books: [],
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      importFile,
    });

    expect(result).toMatchObject({ imported: 0, skipped: 0, failed: 1 });
    expect(result.failures[0]!.error).toContain('Unsupported format');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
