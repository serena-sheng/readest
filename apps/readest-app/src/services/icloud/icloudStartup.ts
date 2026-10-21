/**
 * Startup entry point for the iCloud-backed library.
 *
 * The local `Books/` folder becomes a symbolic link to
 * `<iCloud Drive>/Readest/Books`, so the library is stored once — in iCloud.
 * Called once after the app service initialises and before the library is
 * read; turning the feature off leaves local storage untouched.
 */

import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { ensureIcloudLibrary, type IcloudPaths } from './icloudLibrary';
import { migrateLocalBooksToIcloud, type MigrationResult } from './icloudMigration';

export interface IcloudSetupResult {
  paths: IcloudPaths;
  migration: MigrationResult;
}

/** The switch defaults to on for macOS; only an explicit `false` disables it. */
export const isIcloudLibraryEnabled = (settings: Partial<SystemSettings> | null | undefined) =>
  settings?.icloudMirrorEnabled !== false;

/**
 * Ensure the iCloud folder exists and point the local `Books/` path at it,
 * migrating existing local content on first run. Resolves `null` when iCloud
 * is unavailable (non-macOS, signed out, denied), in which case the caller
 * must leave the local library alone.
 */
export async function setupIcloudLibrary(
  appService: AppService,
): Promise<IcloudSetupResult | null> {
  if (!appService.isMacOSApp) return null;

  const paths = await ensureIcloudLibrary(appService);
  if (!paths) return null;

  try {
    const localBooksDir = await appService.resolveFilePath('', 'Books');
    if (!localBooksDir) return null;
    const migration = await migrateLocalBooksToIcloud(appService, paths, localBooksDir);
    return { paths, migration };
  } catch (error) {
    console.debug('[iCloud] library setup failed:', error);
    return null;
  }
}
