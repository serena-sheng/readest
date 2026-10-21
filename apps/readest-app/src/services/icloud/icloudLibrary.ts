/**
 * iCloud Drive library root management.
 *
 * The library lives in the user's iCloud Drive (`Readest/Books/`) so the same
 * files are the source on every device. The app's own `Books/` directory is a
 * symbolic link to that folder — see `icloudMigration` for the one-time move
 * and link creation.
 *
 * Everything here is best-effort: a missing iCloud Drive (signed out, account
 * unavailable, non-macOS host) resolves to `null` rather than throwing, and
 * the caller leaves local storage untouched.
 */

import type { AppService } from '@/types/system';

export const ICLOUD_LIBRARY_DIRNAME = 'Readest';
export const ICLOUD_BOOKS_SUBDIR = 'Books';
export const ICLOUD_MANIFEST_FILENAME = 'library.json';
/** `$HOME`-relative path of the iCloud Drive root on macOS. */
export const ICLOUD_DRIVE_RELATIVE_DIR = 'Library/Mobile Documents/com~apple~CloudDocs';

export interface IcloudPaths {
  /** Absolute `<iCloud Drive>/Readest`. */
  root: string;
  /** Absolute `<iCloud Drive>/Readest/Books`, the library root. */
  books: string;
  /** Absolute `<iCloud Drive>/Readest/library.json`. */
  manifest: string;
}

export interface ResolveIcloudOptions {
  /** Override the Tauri home directory (tests, or an injected resolver). */
  homeDir?: string;
}

/** Join absolute-path segments without doubling separators. */
export const joinAbsolutePath = (base: string, ...parts: string[]): string =>
  [base.replace(/\/+$/, ''), ...parts.map((part) => part.replace(/^\/+|\/+$/g, ''))]
    .filter(Boolean)
    .join('/');

/**
 * The home directory of the current user. `@tauri-apps/api/path` is imported
 * dynamically because the web build must never resolve the Tauri package.
 */
const resolveHomeDir = async (): Promise<string | null> => {
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    return await homeDir();
  } catch {
    return null;
  }
};

/**
 * Absolute path of the iCloud Drive root, or `null` when this host has no
 * usable iCloud Drive. Only macOS apps can use it.
 */
export async function resolveIcloudRoot(
  appService: AppService,
  options: ResolveIcloudOptions = {},
): Promise<string | null> {
  if (!appService.isMacOSApp) return null;
  const home = options.homeDir ?? (await resolveHomeDir());
  if (!home) {
    console.debug('[iCloud] home directory unavailable');
    return null;
  }
  const root = joinAbsolutePath(home, ICLOUD_DRIVE_RELATIVE_DIR);
  try {
    if (!(await appService.exists(root, 'None'))) {
      console.debug('[iCloud] iCloud Drive directory not found:', root);
      return null;
    }
  } catch (error) {
    console.debug('[iCloud] failed to probe iCloud Drive:', error);
    return null;
  }
  return root;
}

/**
 * Idempotently create `<iCloud Drive>/Readest/Books`. Returns `null` when
 * iCloud is unavailable; never throws for the expected "no iCloud" case.
 */
export async function ensureIcloudLibrary(
  appService: AppService,
  options: ResolveIcloudOptions = {},
): Promise<IcloudPaths | null> {
  const icloudRoot = await resolveIcloudRoot(appService, options);
  if (!icloudRoot) return null;

  const root = joinAbsolutePath(icloudRoot, ICLOUD_LIBRARY_DIRNAME);
  const books = joinAbsolutePath(root, ICLOUD_BOOKS_SUBDIR);
  const manifest = joinAbsolutePath(root, ICLOUD_MANIFEST_FILENAME);

  try {
    if (!(await appService.exists(books, 'None'))) {
      await appService.createDir(books, 'None', true);
    }
  } catch (error) {
    console.debug('[iCloud] failed to create the library folder:', error);
    return null;
  }

  return { root, books, manifest };
}
