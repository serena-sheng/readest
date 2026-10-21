import { beforeEach, describe, expect, it, vi } from 'vitest';

import { translateToMargin } from '@/app/reader/components/marginalia/anchorTranslate';
import { clear, list } from '@/services/marginalia/store';

const BOOK = 'book-anchor';
const ANCHOR = 'epubcfi(/6/2!/4/6/1:0)';

beforeEach(() => {
  clear(BOOK);
});

describe('translateToMargin', () => {
  it('writes the translation into the margin store', async () => {
    const note = await translateToMargin({
      bookKey: BOOK,
      anchorCfi: ANCHOR,
      text: 'Hello',
      id: 'translation-1',
      now: 10,
      translate: async () => ['你好'],
    });

    expect(note).toMatchObject({
      id: 'translation-1',
      anchorCfi: ANCHOR,
      kind: 'translation',
      text: '你好',
      at: 10,
    });
    expect(list(BOOK)).toEqual([note]);
  });

  it('never opens the floating card on the margin path', async () => {
    const openLegacySurface = vi.fn();

    await translateToMargin({
      bookKey: BOOK,
      anchorCfi: ANCHOR,
      text: 'Hello',
      marginAvailable: true,
      openLegacySurface,
      translate: async () => ['你好'],
    });

    expect(openLegacySurface).not.toHaveBeenCalled();
    expect(list(BOOK)).toHaveLength(1);
  });

  it('replaces a repeated translation of the same paragraph instead of appending', async () => {
    await translateToMargin({
      bookKey: BOOK,
      anchorCfi: ANCHOR,
      text: 'Hello',
      id: 'first',
      now: 1,
      translate: async () => ['版本一'],
    });
    await translateToMargin({
      bookKey: BOOK,
      anchorCfi: ANCHOR,
      text: 'Hello',
      id: 'second',
      now: 2,
      translate: async () => ['版本二'],
    });

    expect(list(BOOK)).toHaveLength(1);
    expect(list(BOOK)[0]).toMatchObject({ id: 'second', text: '版本二' });
  });

  it('hands off to the floating card when the margin is unavailable', async () => {
    const openLegacySurface = vi.fn();

    const note = await translateToMargin({
      bookKey: BOOK,
      anchorCfi: ANCHOR,
      text: 'Hello',
      marginAvailable: false,
      openLegacySurface,
      translate: async () => ['你好'],
    });

    expect(note).toBeNull();
    expect(openLegacySurface).toHaveBeenCalledTimes(1);
    expect(list(BOOK)).toEqual([]);
  });

  it('reports provider failures and writes nothing', async () => {
    const onError = vi.fn();

    await expect(
      translateToMargin({
        bookKey: BOOK,
        anchorCfi: ANCHOR,
        text: 'Hello',
        onError,
        translate: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(list(BOOK)).toEqual([]);
  });
});
