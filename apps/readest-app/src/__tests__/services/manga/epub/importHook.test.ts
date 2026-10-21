import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

import { prepareFolderImport, prepareImportSelection } from '@/services/manga/epub/importHook';
import { createMemoryFs } from '../import/_memoryFs';
import { pngBytes } from './_epubTestUtils';

const image = () => pngBytes(600, 900);
const archive = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 0 });

function depsSeeded(seed: Parameters<typeof createMemoryFs>[0]) {
  const fs = createMemoryFs(seed);
  const persisted: string[] = [];
  const persistEpub = vi.fn(async (fileName: string, blob: Blob) => {
    persisted.push(fileName);
    expect(blob.size).toBeGreaterThan(0);
    return `Books/${fileName}`;
  });
  return { fs, persisted, persistEpub, deps: { fs, persistEpub } };
}

describe('prepareImportSelection', () => {
  it('converts a zip and hands only the generated EPUB to ingest', async () => {
    const { fs, persisted, deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image(), '2.png': image() }),
    });
    const ingest = vi.fn(async (target: File | string) => target);

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);
    expect(prepared?.converted).toBe(true);
    expect(prepared?.pageCount).toBe(2);
    await ingest(prepared!.importTarget);

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatch(/^book-[0-9a-f]{8}\.epub$/);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(`Books/${persisted[0]}`);
    expect(ingest).not.toHaveBeenCalledWith('/lib/book.zip');
    expect(fs.files.has('/lib/book.zip')).toBe(true);
  });

  it('falls back to the original archive when conversion fails', async () => {
    const { deps, persistEpub } = depsSeeded({
      '/lib/broken.cbz': new TextEncoder().encode('not a zip'),
    });
    const ingest = vi.fn(async (target: File | string) => target);

    const prepared = await prepareImportSelection({ path: '/lib/broken.cbz' }, deps);
    expect(prepared?.converted).toBe(false);
    expect(prepared?.error).toContain('manga-epub: no pages');
    await ingest(prepared!.importTarget);

    expect(persistEpub).not.toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith('/lib/broken.cbz');
  });

  it('passes non-archive selections through untouched', async () => {
    const { deps, persistEpub } = depsSeeded({ '/lib/novel.epub': new Uint8Array([1]) });

    const prepared = await prepareImportSelection({ path: '/lib/novel.epub' }, deps);

    expect(prepared).toMatchObject({
      importTarget: '/lib/novel.epub',
      converted: false,
      pageCount: 0,
    });
    expect(prepared?.error).toBeUndefined();
    expect(persistEpub).not.toHaveBeenCalled();
  });
});

describe('prepareFolderImport', () => {
  it('converts a folder that holds enough top-level images', async () => {
    const seed: Record<string, Uint8Array> = {};
    for (let index = 1; index <= 5; index += 1) seed[`/lib/vol/${index}.png`] = image();
    const { deps, persisted } = depsSeeded(seed);

    const prepared = await prepareFolderImport('/lib/vol', deps);

    expect(prepared?.converted).toBe(true);
    expect(prepared?.pageCount).toBe(5);
    expect(persisted[0]).toMatch(/^vol-[0-9a-f]{8}\.epub$/);
  });

  it('leaves a folder with fewer than five images to the normal importer', async () => {
    const { deps, persistEpub } = depsSeeded({
      '/lib/vol/1.png': image(),
      '/lib/vol/2.png': image(),
    });

    expect(await prepareFolderImport('/lib/vol', deps)).toBeNull();
    expect(persistEpub).not.toHaveBeenCalled();
  });
});
