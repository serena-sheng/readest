/**
 * Discovers import units under a library folder.
 *
 * A unit is either a single `.cbz`/`.zip` file or one directory containing at
 * least {@link MIN_FOLDER_IMAGES} images *directly*. Directories without
 * images of their own (index folders, `conv/`, download staging folders) are
 * skipped rather than descended into, which keeps one folder = one work.
 */

import { isImageFileName, stripExtension } from './fs';
import type { ImportUnit, MangaFs } from './types';
import { countZipImages } from './zip';

/** A directory needs at least this many direct images to become a unit. */
export const MIN_FOLDER_IMAGES = 5;

const ARCHIVE_EXTENSIONS: Record<string, true> = {
  cbz: true,
  zip: true,
};

/**
 * Scans the direct children of `rootPath` and returns import units sorted by
 * path. Archive image counts come from the ZIP central directory, so this is
 * cheap even for very large CBZ files. A corrupt archive is still listed
 * (with `images: 0`) so the user sees it instead of silently losing a work.
 */
export async function scanImportUnits(rootPath: string, fs: MangaFs): Promise<ImportUnit[]> {
  const entries = await fs.readDir(rootPath);
  const units: ImportUnit[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isFile) {
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0) continue;
      const extension = entry.name.slice(dot + 1).toLowerCase();
      if (ARCHIVE_EXTENSIONS[extension] !== true) continue;
      let images = 0;
      try {
        images = await countZipImages(fs, entry.path);
      } catch {
        // A unreadable/corrupt archive must not abort the whole scan.
        images = 0;
      }
      units.push({
        kind: 'archive',
        path: entry.path,
        images,
        title: stripExtension(entry.name),
      });
      continue;
    }

    if (!entry.isDirectory) continue;

    const children = await fs.readDir(entry.path);
    const images = children.filter(
      (child) => child.isFile && !child.name.startsWith('.') && isImageFileName(child.name),
    ).length;
    if (images < MIN_FOLDER_IMAGES) continue;

    units.push({ kind: 'folder', path: entry.path, images, title: entry.name });
  }

  units.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return units;
}
