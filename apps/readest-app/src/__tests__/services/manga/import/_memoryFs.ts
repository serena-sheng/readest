/**
 * In-memory {@link MangaFs} for the manga import tests.
 *
 * Directories are implicit: a path is a directory when some file path starts
 * with `<path>/`. Missing paths throw, mirroring a real filesystem so the
 * production code's fallbacks are exercised.
 */

import type { MangaDirEntry, MangaFs, MangaStat } from '@/services/manga/import/types';

export interface MemoryFs extends MangaFs {
  files: Map<string, string | Uint8Array>;
  /** Paths passed to `writeTextFile`, in order. */
  written: string[];
}

function normalize(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

export function createMemoryFs(seed: Record<string, string | Uint8Array> = {}): MemoryFs {
  const files = new Map(Object.entries(seed));
  const written: string[] = [];

  const listChildren = (dir: string): MangaDirEntry[] => {
    const prefix = `${normalize(dir)}/`;
    const children = new Map<string, MangaDirEntry>();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      if (name.length === 0) continue;
      children.set(name, {
        name,
        path: `${prefix}${name}`,
        isFile: slash < 0,
        isDirectory: slash >= 0,
      });
    }
    return [...children.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };

  return {
    files,
    written,

    async readTextFile(path: string): Promise<string> {
      const value = files.get(normalize(path));
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return typeof value === 'string' ? value : new TextDecoder().decode(value);
    },

    async writeTextFile(path: string, data: string): Promise<void> {
      const key = normalize(path);
      files.set(key, data);
      written.push(key);
    },

    async readDir(path: string): Promise<MangaDirEntry[]> {
      const dir = normalize(path);
      if (files.has(dir)) throw new Error(`ENOTDIR: ${path}`);
      const children = listChildren(dir);
      if (children.length === 0) throw new Error(`ENOENT: ${path}`);
      return children;
    },

    async stat(path: string): Promise<MangaStat> {
      const key = normalize(path);
      const value = files.get(key);
      if (value !== undefined) {
        return { size: toBytes(value).byteLength, isFile: true, isDirectory: false };
      }
      if ([...files.keys()].some((candidate) => candidate.startsWith(`${key}/`))) {
        return { size: 0, isFile: false, isDirectory: true };
      }
      throw new Error(`ENOENT: ${path}`);
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const value = files.get(normalize(path));
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return toBytes(value).slice(offset, offset + length);
    },
  };
}
