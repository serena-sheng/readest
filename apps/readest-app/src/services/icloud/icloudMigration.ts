/**
 * One-time move of the local library into iCloud Drive, plus the symbolic
 * link that keeps the app's `Books/` path pointing at it afterwards.
 *
 * The migration is transactional from the user's point of view: every entry
 * is copied to iCloud first, and the local folder is deleted only once every
 * entry is present there. A failure rolls back whatever this run created on
 * the iCloud side and leaves the local folder untouched, so the operation can
 * be retried.
 */

import type { AppService, FileItem } from '@/types/system';
import { getFilename } from '@/utils/path';
import type { IcloudPaths } from './icloudLibrary';

export interface MigrationResult {
  /** Top-level entries that did not exist in iCloud and were copied. */
  moved: number;
  /** Top-level entries already in iCloud that were merged into. */
  merged: number;
  /** Basenames that could not be moved; empty on success. */
  failed: string[];
  /** True when the app's `Books/` path points at iCloud afterwards. */
  linked: boolean;
  /** Detail for a failure that aborted the run before any entry was handled. */
  error?: string;
}

interface CreatedPaths {
  files: string[];
  dirs: string[];
}

const joinChild = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? 'Unknown error');

/**
 * Copy a directory tree, skipping files already present at the destination.
 * Every path this run creates is recorded so a later failure can undo it.
 */
async function copyTree(
  appService: AppService,
  srcDir: string,
  dstDir: string,
  created: CreatedPaths,
): Promise<void> {
  if (!(await appService.exists(dstDir, 'None'))) {
    await appService.createDir(dstDir, 'None', true);
    created.dirs.push(dstDir);
  }
  const entries = await appService.readDirectory(srcDir, 'None');
  for (const entry of entries) {
    const name = getFilename(entry.path);
    const src = joinChild(srcDir, name);
    const dst = joinChild(dstDir, name);
    if (await appService.isDirectory(src, 'None')) {
      await copyTree(appService, src, dst, created);
    } else if (!(await appService.exists(dst, 'None'))) {
      await appService.copyFile(src, 'None', dst, 'None');
      created.files.push(dst);
    }
  }
}

/** Undo everything this run created on the iCloud side (best effort). */
async function rollback(appService: AppService, created: CreatedPaths): Promise<void> {
  for (const file of created.files) {
    await appService.deleteFile(file, 'None').catch(() => {});
  }
  for (const dir of [...created.dirs].reverse()) {
    await appService.deleteDir(dir, 'None', true).catch(() => {});
  }
}

/**
 * Make `localBooksDir` a symbolic link to the iCloud library.
 *
 * - Already a link (or absent): the link is created/repaired and nothing is
 *   moved, so repeated calls are cheap and idempotent.
 * - A real directory: its entries are copied into iCloud first (merging with
 *   anything already there, never overwriting), then the local directory is
 *   deleted and replaced by the link. Any copy failure rolls back and leaves
 *   the local directory in place.
 */
export async function migrateLocalBooksToIcloud(
  appService: AppService,
  paths: IcloudPaths,
  localBooksDir: string,
): Promise<MigrationResult> {
  const result: MigrationResult = { moved: 0, merged: 0, failed: [], linked: false };
  if (!localBooksDir) {
    return { ...result, failed: [''], error: 'Local books directory is unknown' };
  }
  if (!appService.ensureSymlink) {
    return {
      ...result,
      failed: [localBooksDir],
      error: 'Symbolic links are not supported on this platform',
    };
  }

  let localIsRealDir = false;
  if (await appService.exists(localBooksDir, 'None')) {
    try {
      await appService.ensureSymlink(paths.books, localBooksDir);
      return { ...result, linked: true };
    } catch {
      // Exists but is not a link: this is the one true migration case.
      localIsRealDir = true;
    }
  }
  if (!localIsRealDir) {
    try {
      await appService.ensureSymlink(paths.books, localBooksDir);
      return { ...result, linked: true };
    } catch (error) {
      return { ...result, failed: [localBooksDir], error: errorMessage(error) };
    }
  }

  let entries: FileItem[];
  try {
    entries = await appService.readDirectory(localBooksDir, 'None');
  } catch (error) {
    return { ...result, failed: [getFilename(localBooksDir)], error: errorMessage(error) };
  }

  const created: CreatedPaths = { files: [], dirs: [] };
  let failedEntry: string | null = null;
  let failure: unknown = null;
  for (const entry of entries) {
    const name = getFilename(entry.path);
    const src = joinChild(localBooksDir, name);
    const dst = joinChild(paths.books, name);
    try {
      const existed = await appService.exists(dst, 'None');
      if (await appService.isDirectory(src, 'None')) {
        await copyTree(appService, src, dst, created);
      } else if (!existed) {
        await appService.copyFile(src, 'None', dst, 'None');
        created.files.push(dst);
      }
      if (existed) result.merged += 1;
      else result.moved += 1;
    } catch (error) {
      failedEntry = name;
      failure = error;
      break;
    }
  }

  if (failedEntry || failure) {
    await rollback(appService, created);
    return {
      ...result,
      moved: 0,
      merged: 0,
      failed: [failedEntry ?? localBooksDir],
      error: errorMessage(failure),
    };
  }

  // Every entry must exist in iCloud before local data is removed.
  const missing: string[] = [];
  for (const entry of entries) {
    const name = getFilename(entry.path);
    if (!(await appService.exists(joinChild(paths.books, name), 'None'))) missing.push(name);
  }
  if (missing.length > 0) {
    await rollback(appService, created);
    return {
      ...result,
      moved: 0,
      merged: 0,
      failed: missing,
      error: 'Some files did not reach iCloud Drive',
    };
  }

  try {
    await appService.deleteDir(localBooksDir, 'None', true);
    await appService.ensureSymlink(paths.books, localBooksDir);
  } catch (error) {
    return { ...result, failed: [getFilename(localBooksDir)], error: errorMessage(error) };
  }

  return { ...result, linked: true };
}
