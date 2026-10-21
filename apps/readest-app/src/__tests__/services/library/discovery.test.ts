import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: mocks.isTauri }));

import type { Book } from '@/types/book';
import {
  candidateTag,
  defaultSelected,
  discoverImportable,
  parseCandidateTitle,
  seriesKey,
  type ScanHit,
} from '@/services/library/discovery';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const noHash = async () => null;

const makeBook = (overrides: Partial<Book>): Book =>
  ({
    hash: 'h1',
    format: 'EPUB',
    title: 'Book',
    author: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }) as Book;

const hit = (overrides: Partial<ScanHit>): ScanHit => ({
  path: '/scan/Book.epub',
  size: 5 * MB,
  modified: 0,
  kind: 'epub',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockResolvedValue([]);
});

describe('discoverImportable scoring', () => {
  it('gives a not-in-library, recent, large book the full bonus', async () => {
    mocks.invoke.mockResolvedValue([
      hit({ size: 30 * MB, modified: Date.now() - DAY }),
    ]);

    const [candidate] = await discoverImportable({
      roots: ['~/Downloads'],
      library: [],
      hashFile: noHash,
    });

    // +40 not in library, +15 recent, +10 over 20MB
    expect(candidate!.score).toBe(65);
    expect(candidate!.alreadyInLibrary).toBe(false);
    expect(candidate!.duplicateOf).toBeUndefined();
    expect(defaultSelected(candidate!)).toBe(true);
  });

  it('marks a same-series title as a new volume even when the full title is absent', async () => {
    mocks.invoke.mockResolvedValue([
      hit({ path: '/scan/Series 第2巻.epub', size: 5 * MB }),
    ]);

    const [candidate] = await discoverImportable({
      roots: ['/scan'],
      library: [makeBook({ title: 'Series 第1巻' })],
      hashFile: noHash,
    });

    expect(candidate!.reason).toBe('同系列新卷');
    // +40 not in library + 25 series sibling
    expect(candidate!.score).toBe(65);
    expect(candidate!.alreadyInLibrary).toBe(false);
  });

  it('penalises a title duplicate of a library book and records which book', async () => {
    mocks.invoke.mockResolvedValue([hit({ path: '/scan/Book.epub' })]);

    const [candidate] = await discoverImportable({
      roots: ['/scan'],
      library: [makeBook({ title: 'Book' })],
      hashFile: noHash,
    });

    expect(candidate!.score).toBe(-30);
    expect(candidate!.duplicateOf).toBe('h1');
    expect(candidate!.alreadyInLibrary).toBe(false);
    expect(candidateTag(candidate!)).toBe('重复');
    expect(defaultSelected(candidate!)).toBe(false);
  });

  it('keeps an in-library path but pushes it to the bottom’s score', async () => {
    mocks.invoke.mockResolvedValue([
      hit({ path: '/library/Book.epub', size: 30 * MB, modified: Date.now() }),
    ]);

    const [candidate] = await discoverImportable({
      roots: ['/library'],
      library: [makeBook({ filePath: '/library/Book.epub' })],
      hashFile: noHash,
    });

    expect(candidate!.alreadyInLibrary).toBe(true);
    expect(candidate!.score).toBe(-100);
    expect(candidate!.duplicateOf).toBe('h1');
    expect(candidateTag(candidate!)).toBe('已在书库');
    expect(defaultSelected(candidate!)).toBe(false);
  });

  it('treats a byte-identical file as already in the library via its partial hash', async () => {
    mocks.invoke.mockResolvedValue([hit({ path: '/elsewhere/copy.epub' })]);
    const hashFile = vi.fn(async () => 'h1');

    const [candidate] = await discoverImportable({
      roots: ['/elsewhere'],
      library: [makeBook({ hash: 'h1' })],
      hashFile,
    });

    expect(hashFile).toHaveBeenCalledWith('/elsewhere/copy.epub', 5 * MB);
    expect(candidate!.alreadyInLibrary).toBe(true);
    expect(candidate!.duplicateOf).toBe('h1');
  });

  it('does not hash a file whose path is already known', async () => {
    mocks.invoke.mockResolvedValue([hit({ path: '/library/Book.epub' })]);
    const hashFile = vi.fn(async () => 'h1');

    await discoverImportable({
      roots: ['/library'],
      library: [makeBook({ filePath: '/library/Book.epub' })],
      hashFile,
    });

    expect(hashFile).not.toHaveBeenCalled();
  });

  it('penalises tiny files and labels them', async () => {
    mocks.invoke.mockResolvedValue([hit({ path: '/scan/sample.epub', size: 100 * 1024 })]);

    const [candidate] = await discoverImportable({
      roots: ['/scan'],
      library: [],
      hashFile: noHash,
    });

    // +40 not in library, -50 under 200KB
    expect(candidate!.score).toBe(-10);
    expect(candidate!.reason).toBe('体积过小');
    expect(candidateTag(candidate!)).toBe('体积过小');
    expect(defaultSelected(candidate!)).toBe(false);
  });

  it('sorts by score descending and keeps already-present rows visible', async () => {
    mocks.invoke.mockResolvedValue([
      hit({ path: '/scan/known.epub' }),
      hit({ path: '/scan/old.epub', size: 5 * MB }),
      hit({ path: '/scan/fresh.epub', size: 30 * MB, modified: Date.now() - DAY }),
    ]);

    const rows = await discoverImportable({
      roots: ['/scan', '/library'],
      library: [makeBook({ filePath: '/scan/known.epub' })],
      hashFile: noHash,
    });

    expect(rows.map((row) => row.path)).toEqual([
      '/scan/fresh.epub',
      '/scan/old.epub',
      '/scan/known.epub',
    ]);
    expect(rows.at(-1)!.alreadyInLibrary).toBe(true);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });

  it('passes roots and depth through to the native scan', async () => {
    await discoverImportable({
      roots: ['/a', '/b'],
      library: [],
      maxDepth: 3,
      hashFile: noHash,
    });

    expect(mocks.invoke).toHaveBeenCalledWith('scan_importable', {
      roots: ['/a', '/b'],
      maxDepth: 3,
    });
  });

  it('returns an empty list when the scan fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('permission denied'));

    await expect(
      discoverImportable({ roots: ['/'], library: [], hashFile: noHash }),
    ).resolves.toEqual([]);
  });

  it('returns an empty list on the web platform without invoking', async () => {
    mocks.isTauri.mockReturnValue(false);

    await expect(discoverImportable({ roots: ['/'], library: [] })).resolves.toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('returns an empty list for an empty scan result', async () => {
    await expect(
      discoverImportable({ roots: ['/scan'], library: [], hashFile: noHash }),
    ).resolves.toEqual([]);
  });
});

describe('title parsing', () => {
  it('strips extension, bracket tags, and leading volume numbering', () => {
    expect(parseCandidateTitle('/dl/[Group] 03 - Some_Title.epub')).toBe('Some Title');
    expect(parseCandidateTitle('/dl/Vol.2 Another Book.cbz')).toBe('Another Book');
  });

  it('derives the same series key from two volumes', () => {
    expect(seriesKey('Series 第1巻')).toBe(seriesKey('Series 第2巻'));
    expect(seriesKey('Series Vol.3')).toBe(seriesKey('Series Vol.4'));
  });
});
