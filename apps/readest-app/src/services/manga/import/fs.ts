/**
 * Path helpers and the Tauri filesystem adapter for the manga import.
 *
 * Path helpers are deliberately dependency-free (no `node:path`): this module
 * is bundled for the web build too, and only the methods of
 * {@link createTauriMangaFs} reach for `@tauri-apps/plugin-fs`.
 *
 * Those imports are dynamic (`await import`) on purpose: a static import of a
 * Tauri-only package breaks the web bundle, where the package is never used.
 * The module specifier is fixed, so this is the platform-specific-module
 * exception, not runtime-selected loading.
 */

import { isTauriAppPlatform } from '@/services/environment';
import type { MangaDirEntry, MangaFs, MangaStat } from './types';

const IMAGE_EXTENSIONS: Record<string, true> = {
  jpg: true,
  jpeg: true,
  png: true,
  webp: true,
  gif: true,
  bmp: true,
  avif: true,
  heic: true,
  heif: true,
  tif: true,
  tiff: true,
  jxl: true,
};

/** True when `name` looks like a page image. Directories are rejected by callers. */
export function isImageFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS[name.slice(dot + 1).toLowerCase()] === true;
}

/** Joins path segments with the separator style of the first segment. */
export function joinPath(...parts: string[]): string {
  const segments = parts.filter((part) => part.length > 0);
  if (segments.length === 0) return '';
  const first = segments[0]!;

  // A bare root is not a segment: `/` + `a` must stay `/a`, not `//a`.
  if (first === '/' || first === '\\') {
    const rest = segments
      .slice(1)
      .map((part) => part.replace(/^[/\\]+|[/\\]+$/g, ''))
      .filter((part) => part.length > 0);
    return rest.length > 0 ? `${first}${rest.join(first)}` : first;
  }

  const separator = first.includes('\\') && !first.includes('/') ? '\\' : '/';
  return segments
    .map((part, index) => {
      const trimmedStart = index === 0 ? part : part.replace(/^[/\\]+/, '');
      const trimmedEnd =
        index === segments.length - 1 ? trimmedStart : trimmedStart.replace(/[/\\]+$/, '');
      return trimmedEnd;
    })
    .join(separator);
}

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

/** Final path segment (`/a/b/c` → `c`). A trailing separator is ignored. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const index = lastSeparator(trimmed);
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/** Parent path (`/a/b/c` → `/a/b`). Returns `.` when there is no parent. */
export function dirname(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const index = lastSeparator(trimmed);
  if (index < 0) return '.';
  if (index === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, index);
}

/** Removes the final extension (`a.b.zip` → `a.b`). */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Filesystem backed by `@tauri-apps/plugin-fs`.
 *
 * Throws on non-Tauri platforms: the web build has no access to arbitrary
 * library folders, so callers must inject a {@link MangaFs} instead.
 */
export function createTauriMangaFs(): MangaFs {
  if (!isTauriAppPlatform()) {
    throw new Error('createTauriMangaFs() requires the Tauri app platform');
  }

  return {
    async readTextFile(path: string): Promise<string> {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return readTextFile(path);
    },

    async writeTextFile(path: string, data: string): Promise<void> {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, data);
    },

    async readDir(path: string): Promise<MangaDirEntry[]> {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(path);
      return entries.map((entry) => ({
        name: entry.name,
        path: joinPath(path, entry.name),
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
      }));
    },

    async stat(path: string): Promise<MangaStat> {
      const { stat } = await import('@tauri-apps/plugin-fs');
      const info = await stat(path);
      return {
        size: info.size,
        isFile: info.isFile,
        isDirectory: info.isDirectory,
      };
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const { open, SeekMode } = await import('@tauri-apps/plugin-fs');
      const file = await open(path, { read: true });
      try {
        await file.seek(offset, SeekMode.Start);
        const buffer = new Uint8Array(length);
        const read = await file.read(buffer);
        return read === null ? new Uint8Array(0) : buffer.subarray(0, read);
      } finally {
        await file.close();
      }
    },
  };
}
