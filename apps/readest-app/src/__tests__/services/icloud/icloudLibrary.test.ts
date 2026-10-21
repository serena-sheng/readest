import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import {
  ICLOUD_BOOKS_SUBDIR,
  ICLOUD_LIBRARY_DIRNAME,
  ensureIcloudLibrary,
  resolveIcloudRoot,
} from '@/services/icloud/icloudLibrary';

const HOME = '/Users/serena';
const ICLOUD_DRIVE = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;

const makeService = (opts: { isMacOS?: boolean; dirs?: string[] } = {}) => {
  const dirs = new Set(opts.dirs ?? []);
  const exists = vi.fn(async (path: string) => dirs.has(path));
  const createDir = vi.fn(async (path: string) => {
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i += 1) {
      const partial = segments.slice(0, i).join('/');
      if (partial) dirs.add(partial);
    }
  });
  const service = {
    isMacOSApp: opts.isMacOS ?? true,
    exists,
    createDir,
  } as unknown as AppService;
  return { service, exists, createDir, dirs };
};

describe('resolveIcloudRoot', () => {
  it('resolves the iCloud Drive root on macOS', async () => {
    const { service } = makeService({ dirs: [ICLOUD_DRIVE] });
    await expect(resolveIcloudRoot(service, { homeDir: HOME })).resolves.toBe(ICLOUD_DRIVE);
  });

  it('returns null on non-macOS hosts without probing the filesystem', async () => {
    const { service, exists } = makeService({ isMacOS: false, dirs: [ICLOUD_DRIVE] });
    await expect(resolveIcloudRoot(service, { homeDir: HOME })).resolves.toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });

  it('returns null when iCloud Drive is absent (signed out or unavailable)', async () => {
    const { service } = makeService({ dirs: [`${HOME}/Library`] });
    await expect(resolveIcloudRoot(service, { homeDir: HOME })).resolves.toBeNull();
  });

  it('returns null when the home directory cannot be resolved', async () => {
    const { service } = makeService({ dirs: [ICLOUD_DRIVE] });
    // No injected home: the Tauri path module is unavailable under jsdom.
    await expect(resolveIcloudRoot(service)).resolves.toBeNull();
  });
});

describe('ensureIcloudLibrary', () => {
  it('creates the Readest/Books folder once and returns its paths', async () => {
    const { service, createDir, dirs } = makeService({ dirs: [ICLOUD_DRIVE] });
    const paths = await ensureIcloudLibrary(service, { homeDir: HOME });

    const root = `${ICLOUD_DRIVE}/${ICLOUD_LIBRARY_DIRNAME}`;
    expect(paths).toEqual({
      root,
      books: `${root}/${ICLOUD_BOOKS_SUBDIR}`,
      manifest: `${root}/library.json`,
    });
    expect(createDir).toHaveBeenCalledTimes(1);
    expect(dirs.has(paths!.books)).toBe(true);
  });

  it('is idempotent when the folder already exists', async () => {
    const { service, createDir } = makeService({
      dirs: [ICLOUD_DRIVE, `${ICLOUD_DRIVE}/${ICLOUD_LIBRARY_DIRNAME}/${ICLOUD_BOOKS_SUBDIR}`],
    });
    const first = await ensureIcloudLibrary(service, { homeDir: HOME });
    const second = await ensureIcloudLibrary(service, { homeDir: HOME });

    expect(second).toEqual(first);
    expect(createDir).not.toHaveBeenCalled();
  });

  it('returns null when iCloud Drive is unavailable', async () => {
    const { service, createDir } = makeService({ dirs: [] });
    await expect(ensureIcloudLibrary(service, { homeDir: HOME })).resolves.toBeNull();
    expect(createDir).not.toHaveBeenCalled();
  });
});
