import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

const { extractCoverFieldsMock } = vi.hoisted(() => ({ extractCoverFieldsMock: vi.fn() }));

vi.mock('@/services/manga/cover/coverMetadata', () => ({
  extractCoverFields: extractCoverFieldsMock,
}));

import { prepareFolderImport, prepareImportSelection } from '@/services/manga/epub/importHook';
import { createMemoryFs, type MemoryFs } from '../import/_memoryFs';
import { pngBytes } from './_epubTestUtils';

const image = () => pngBytes(600, 900);
const archive = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 0 });

const COVER = {
  title: 'From Cover',
  artist: 'wataya',
  circle: 'circle-a',
  parody: 'original',
  language: 'japanese',
  tags: ['romance'],
};

function depsSeeded(seed: Parameters<typeof createMemoryFs>[0]) {
  const fs = createMemoryFs(seed);
  const persistEpub = vi.fn(async (fileName: string, blob: Blob) => {
    expect(blob.size).toBeGreaterThan(0);
    return `Books/${fileName}`;
  });
  return { fs, deps: { fs, persistEpub } };
}

const sidecar = (fs: MemoryFs, path: string) => JSON.parse(fs.files.get(path) as string);

describe('cover recognition during import', () => {
  it('reads the cover of an archive without a title and writes the sidecars', async () => {
    extractCoverFieldsMock.mockReset().mockResolvedValue(COVER);
    const { fs, deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image(), '2.png': image() }),
    });
    const onCoverProgress = vi.fn();

    const prepared = await prepareImportSelection(
      { path: '/lib/book.zip' },
      { ...deps, onCoverProgress },
    );

    expect(prepared?.converted).toBe(true);
    expect(extractCoverFieldsMock).toHaveBeenCalledTimes(1);
    const args = extractCoverFieldsMock.mock.calls[0]![0];
    expect(args.mimeType).toBe('image/png');
    expect(args.image).toBeInstanceOf(Uint8Array);
    expect(args.image.byteLength).toBeGreaterThan(0);
    expect(onCoverProgress).toHaveBeenCalledWith('book');

    expect(sidecar(fs, '/lib/book.metadata.json')).toMatchObject({
      title: 'From Cover',
      uploader: 'wataya',
      language: ['japanese'],
      tags_source: 'cover',
    });
    expect(fs.files.has('/lib/book.ComicInfo.xml')).toBe(true);
  });

  it('does not call the model when the sidecar already names the work and artist', async () => {
    extractCoverFieldsMock.mockReset().mockResolvedValue(COVER);
    const existing = JSON.stringify({
      schema: 1,
      title: 'Known Title',
      uploader: 'Someone',
    });
    const { fs, deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image() }),
      '/lib/book.metadata.json': existing,
    });

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(prepared?.converted).toBe(true);
    expect(extractCoverFieldsMock).not.toHaveBeenCalled();
    expect(fs.files.get('/lib/book.metadata.json')).toBe(existing);
  });

  it('still completes the import when the model cannot read the cover', async () => {
    extractCoverFieldsMock.mockReset().mockResolvedValue(null);
    const { fs, deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image() }),
    });

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(prepared?.converted).toBe(true);
    expect(prepared?.importTarget).toMatch(/^Books\/book-[0-9a-f]{8}\.epub$/);
    expect(prepared?.error).toBeUndefined();
    expect(fs.files.has('/lib/book.metadata.json')).toBe(false);
  });

  it('swallows a thrown model error', async () => {
    extractCoverFieldsMock.mockReset().mockRejectedValue(new Error('endpoint down'));
    const { deps } = depsSeeded({ '/lib/book.zip': archive({ '1.png': image() }) });

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(prepared?.converted).toBe(true);
    expect(prepared?.error).toBeUndefined();
  });

  it('reads the cover of a folder volume and writes metadata.json inside it', async () => {
    extractCoverFieldsMock.mockReset().mockResolvedValue(COVER);
    const seed: Record<string, Uint8Array> = {};
    for (let index = 1; index <= 5; index += 1) seed[`/lib/vol/${index}.png`] = image();
    const { fs, deps } = depsSeeded(seed);
    const onCoverProgress = vi.fn();

    const prepared = await prepareFolderImport('/lib/vol', { ...deps, onCoverProgress });

    expect(prepared?.converted).toBe(true);
    expect(extractCoverFieldsMock).toHaveBeenCalledTimes(1);
    expect(onCoverProgress).toHaveBeenCalledWith('vol');
    expect(sidecar(fs, '/lib/vol/metadata.json')).toMatchObject({ title: 'From Cover' });
    expect(fs.files.has('/lib/vol/ComicInfo.xml')).toBe(true);
  });
});
