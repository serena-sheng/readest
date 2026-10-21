import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import type * as EpubBuilderModule from '@/services/manga/epub/buildFixedLayoutEpub';

const { extractCoverFieldsMock, buildEpubMock } = vi.hoisted(() => ({
  extractCoverFieldsMock: vi.fn(),
  buildEpubMock: vi.fn(),
}));

vi.mock('@/services/manga/cover/coverMetadata', () => ({
  extractCoverFields: extractCoverFieldsMock,
}));

vi.mock('@/services/manga/epub/buildFixedLayoutEpub', async (importOriginal) => {
  const actual = await importOriginal<typeof EpubBuilderModule>();
  return { ...actual, buildFixedLayoutEpub: buildEpubMock };
});

import { prepareFolderImport, prepareImportSelection } from '@/services/manga/epub/importHook';
import type { FixedLayoutEpubOptions } from '@/services/manga/epub/buildFixedLayoutEpub';
import { createMemoryFs } from '../import/_memoryFs';
import { pngBytes } from './_epubTestUtils';

const image = () => pngBytes(600, 900);
const archive = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 0 });

const COVER = {
  title: 'From Cover',
  artist: 'wataya',
  circle: '',
  parody: 'original',
  language: 'japanese',
  tags: ['romance'],
};

function depsSeeded(seed: Parameters<typeof createMemoryFs>[0]) {
  const fs = createMemoryFs(seed);
  const persistEpub = vi.fn(async (fileName: string) => `Books/${fileName}`);
  return { fs, deps: { fs, persistEpub } };
}

/** The options the converter handed to the builder, ignoring page contents. */
function builtOptions(call = 0): FixedLayoutEpubOptions {
  return buildEpubMock.mock.calls[call]![1] as FixedLayoutEpubOptions;
}

const bytesOf = (value: unknown): Uint8Array => value as Uint8Array;

beforeEach(() => {
  extractCoverFieldsMock.mockReset();
  buildEpubMock.mockReset().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
});

describe('cover recognition before the EPUB build', () => {
  it('recognizes the cover of an untitled archive before building with its title', async () => {
    extractCoverFieldsMock.mockResolvedValue(COVER);
    const { deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image(), '2.png': image() }),
    });
    const events: string[] = [];

    const prepared = await prepareImportSelection(
      { path: '/lib/book.zip' },
      {
        ...deps,
        onCoverProgress: () => events.push('cover'),
        onConvertProgress: () => events.push('convert'),
      },
    );

    expect(prepared?.converted).toBe(true);
    expect(buildEpubMock).toHaveBeenCalledTimes(1);
    expect(builtOptions().title).toBe('From Cover');
    expect(builtOptions().author).toBe('wataya');
    expect(extractCoverFieldsMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildEpubMock.mock.invocationCallOrder[0]!,
    );
    expect(events).toEqual(['cover', 'convert']);
  });

  it('does not spend a model request when the sidecar already has a title and uploader', async () => {
    const existing = JSON.stringify({
      schema: 1,
      title: 'Known Title',
      uploader: 'Someone',
    });
    const { deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image() }),
      '/lib/book.metadata.json': existing,
    });

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(prepared?.converted).toBe(true);
    expect(extractCoverFieldsMock).not.toHaveBeenCalled();
    expect(builtOptions().title).toBe('Known Title');
    expect(builtOptions().author).toBe('Someone');
  });

  it('builds with the original metadata and imports when recognition returns null', async () => {
    extractCoverFieldsMock.mockResolvedValue(null);
    const { fs, deps } = depsSeeded({
      '/lib/book.zip': archive({ '1.png': image() }),
    });

    const prepared = await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(prepared?.converted).toBe(true);
    expect(prepared?.importTarget).toMatch(/^Books\/book-[0-9a-f]{8}\.epub$/);
    expect(prepared?.error).toBeUndefined();
    expect(builtOptions().title).toBe('book');
    expect(fs.files.has('/lib/book.metadata.json')).toBe(false);
  });

  it('reads the archive cover from the first central-directory image', async () => {
    extractCoverFieldsMock.mockResolvedValue(COVER);
    const first = pngBytes(610, 900);
    const second = pngBytes(620, 900);
    // Publisher order is central-directory order, not filename order.
    const { deps } = depsSeeded({
      '/lib/book.zip': archive({ 'b.png': first, 'a.png': second }),
    });

    await prepareImportSelection({ path: '/lib/book.zip' }, deps);

    expect(bytesOf(extractCoverFieldsMock.mock.calls[0]![0].image)).toEqual(first);
    expect(buildEpubMock).toHaveBeenCalledTimes(1);
  });

  it('reads the folder cover from the naturally first image', async () => {
    extractCoverFieldsMock.mockResolvedValue(COVER);
    const first = pngBytes(610, 900);
    const later = pngBytes(620, 900);
    const { deps } = depsSeeded({
      '/lib/vol/page10.png': later,
      '/lib/vol/page2.png': first,
      '/lib/vol/page3.png': image(),
      '/lib/vol/page4.png': image(),
      '/lib/vol/page5.png': image(),
    });

    const prepared = await prepareFolderImport('/lib/vol', deps);

    expect(prepared?.converted).toBe(true);
    expect(bytesOf(extractCoverFieldsMock.mock.calls[0]![0].image)).toEqual(first);
    expect(builtOptions().title).toBe('From Cover');
  });
});
