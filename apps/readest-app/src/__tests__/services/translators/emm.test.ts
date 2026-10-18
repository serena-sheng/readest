import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

import { emmProvider } from '@/services/translators/providers/emm';

const SERVICE_URL = 'http://127.0.0.1:8790/translate';

const ok = (paragraphs: Array<{ id: number; text: string }>) =>
  new Response(JSON.stringify({ paragraphs }), { status: 200 });

// The jsdom environment exposes Node's experimental `localStorage` global,
// which is undefined without `--localstorage-file`; the provider reads through
// `window.localStorage`, so a plain in-memory shim is enough here.
const createStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
};

describe('emmProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', createStorage());
  });

  it('posts the default style and the paragraphs to the local service', async () => {
    fetchMock.mockResolvedValue(
      ok([
        { id: 1, text: '你好' },
        { id: 2, text: '世界' },
      ]),
    );

    const out = await emmProvider.translate(['Hello', 'World'], 'en', 'zh-CN');

    expect(out).toEqual(['你好', '世界']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SERVICE_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      style: 'humanities.faithful',
      // Published by the reader chrome so the service can resolve a per-book
      // expert binding; empty outside the reader.
      book: '',
      paragraphs: ['Hello', 'World'],
    });
  });

  it('reads the style from localStorage on every call', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 1, text: '译文' }]));
    window.localStorage.setItem('emm.translationStyle', 'jp_doujin.learn');

    await emmProvider.translate(['Hello'], 'en', 'zh-CN');

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).style).toBe('jp_doujin.learn');
  });

  it('aligns the response by id even when it comes back shuffled', async () => {
    fetchMock.mockResolvedValue(
      ok([
        { id: 3, text: '丙' },
        { id: 1, text: '甲' },
        { id: 2, text: '乙' },
      ]),
    );

    const out = await emmProvider.translate(['one', 'two', 'three'], 'en', 'zh-CN');

    expect(out).toEqual(['甲', '乙', '丙']);
  });

  it('keeps blank inputs in place without sending them', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 1, text: '甲' }]));

    const out = await emmProvider.translate(['', 'one', '   '], 'en', 'zh-CN');

    expect(out).toEqual(['', '甲', '   ']);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).paragraphs).toEqual(['one']);
  });

  it('returns the input untouched when every paragraph is blank', async () => {
    const out = await emmProvider.translate(['', ' '], 'en', 'zh-CN');

    expect(out).toEqual(['', ' ']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws an emm-prefixed error on a non-200 response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(emmProvider.translate(['Hello'], 'en', 'zh-CN')).rejects.toThrow(/^emm: HTTP 500/);
  });

  it('throws an emm-prefixed error on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(emmProvider.translate(['Hello'], 'en', 'zh-CN')).rejects.toThrow(/^emm: /);
  });

  it('rejects a response that drops a paragraph', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 2, text: '乙' }]));

    await expect(emmProvider.translate(['one', 'two'], 'en', 'zh-CN')).rejects.toThrow(
      /^emm: 响应缺少第 1 段/,
    );
  });
});
