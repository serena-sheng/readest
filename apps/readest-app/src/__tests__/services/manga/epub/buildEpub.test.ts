import { describe, expect, it } from 'vitest';

import {
  buildFixedLayoutEpub,
  type EpubPageInput,
} from '@/services/manga/epub/buildFixedLayoutEpub';
import { inspectZip, pngBytes } from './_epubTestUtils';

function pages(): EpubPageInput[] {
  return [
    { name: '001 cover.png', data: pngBytes(800, 1200), mimeType: 'image/png' },
    { name: '002.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' },
    { name: 'spread 3.png', data: pngBytes(1600, 1200), mimeType: 'image/png' },
  ];
}

describe('buildFixedLayoutEpub', () => {
  it('writes mimetype first and stored', async () => {
    const inspection = await inspectZip(await buildFixedLayoutEpub(pages(), { title: 'Manga' }));

    expect(inspection.names[0]).toBe('mimetype');
    expect(inspection.methods[0]).toBe(0);
    expect(inspection.text('mimetype')).toBe('application/epub+zip');
  });

  it('marks the package pre-paginated with automatic spreads', async () => {
    const inspection = await inspectZip(await buildFixedLayoutEpub(pages(), { title: 'Manga' }));
    const opf = inspection.text('OEBPS/content.opf');

    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    expect(opf).toContain('<meta property="rendition:spread">auto</meta>');
    expect(opf).toContain('<dc:title>Manga</dc:title>');
  });

  it('keeps the spine order equal to the input order', async () => {
    const inspection = await inspectZip(await buildFixedLayoutEpub(pages(), { title: 'Manga' }));
    const spine = [
      ...inspection.text('OEBPS/content.opf').matchAll(/<itemref idref="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(spine).toEqual(['page-0001', 'page-0002', 'page-0003']);
  });

  it('marks the configured page as the cover image', async () => {
    const inspection = await inspectZip(
      await buildFixedLayoutEpub(pages(), { title: 'Manga', coverIndex: 2 }),
    );
    const opf = inspection.text('OEBPS/content.opf');

    expect(opf).toMatch(/<item id="img-0003"[^>]*properties="cover-image"/);
    expect(opf).not.toMatch(/<item id="img-0001"[^>]*properties="cover-image"/);
  });

  it('writes a navigation document with custom page labels', async () => {
    const inspection = await inspectZip(
      await buildFixedLayoutEpub(pages(), {
        title: 'Manga',
        pageLabel: (index) => `Page ${index + 1}`,
      }),
    );
    const nav = inspection.text('OEBPS/nav.xhtml');

    expect(inspection.names).toContain('OEBPS/nav.xhtml');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('epub:type="landmarks"');
    expect(nav).toContain('Page 2');
  });

  it('rejects empty input', async () => {
    await expect(buildFixedLayoutEpub([], { title: 'Manga' })).rejects.toThrow(
      'manga-epub: no pages',
    );
  });

  it('writes the intrinsic viewport size when the header is readable', async () => {
    const inspection = await inspectZip(
      await buildFixedLayoutEpub(
        [{ name: 'p.png', data: pngBytes(640, 960), mimeType: 'image/png' }],
        {
          title: 'Manga',
        },
      ),
    );

    expect(inspection.text('OEBPS/pages/p0001.xhtml')).toContain('content="width=640, height=960"');
  });

  it('falls back to 1200×1800 when the image header is unknown', async () => {
    const inspection = await inspectZip(
      await buildFixedLayoutEpub(
        [{ name: 'p.bin', data: new Uint8Array([0, 1, 2, 3]), mimeType: 'image/png' }],
        {
          title: 'Manga',
        },
      ),
    );

    expect(inspection.text('OEBPS/pages/p0001.xhtml')).toContain(
      'content="width=1200, height=1800"',
    );
  });

  it('keeps Chinese names and disambiguates collisions', async () => {
    const inspection = await inspectZip(
      await buildFixedLayoutEpub(
        [
          { name: '第1页.png', data: pngBytes(), mimeType: 'image/png' },
          { name: '第1页.png', data: pngBytes(), mimeType: 'image/png' },
        ],
        { title: 'Manga' },
      ),
    );
    const images = inspection.names.filter((name) => name.startsWith('OEBPS/images/'));

    expect(images).toEqual(['OEBPS/images/第1页.png', 'OEBPS/images/第1页-2.png']);
  });
});
