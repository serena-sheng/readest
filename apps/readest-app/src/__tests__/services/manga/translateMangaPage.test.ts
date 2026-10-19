import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMangaCacheForTests } from '@/services/manga/mangaCache';
import { translateMangaPage } from '@/services/manga/translateMangaPage';
import type { MangaVisionEndpoint } from '@/services/manga/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x10]);
const IMAGE = IMAGE_BYTES.buffer;

const endpoint = (overrides: Partial<MangaVisionEndpoint> = {}): MangaVisionEndpoint => ({
  baseUrl: 'https://vision.example.com/v1',
  model: 'vision-1',
  apiKey: 'sk-test',
  ...overrides,
});

const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const BUBBLES = JSON.stringify([
  { box: [0.1, 0.1, 0.5, 0.5], src: 'こんにちは', dst: '你好', vertical: true },
]);

const call = (overrides: Partial<Parameters<typeof translateMangaPage>[0]> = {}) =>
  translateMangaPage({
    image: IMAGE,
    mimeType: 'image/png',
    width: 100,
    height: 200,
    endpoint: endpoint(),
    ...overrides,
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Cache tests only need the in-memory layer; IndexedDB is exercised in
  // mangaCache.test.ts.
  vi.stubGlobal('indexedDB', undefined);
  resetMangaCacheForTests();
});

afterEach(() => {
  resetMangaCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('translateMangaPage', () => {
  it('posts the documented request shape with a data URL and the glossary prompt', async () => {
    fetchMock.mockResolvedValue(chat(BUBBLES));

    await call({
      endpoint: endpoint({ baseUrl: 'https://vision.example.com/v1/' }),
      glossary: { 猫: '咪咪' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://vision.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'vision-1', temperature: 0.2, stream: false });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    const [textPart, imagePart] = body.messages[0].content;
    expect(textPart.type).toBe('text');
    expect(textPart.text).toContain('你是漫画翻译引擎');
    expect(textPart.text).toContain('猫 → 咪咪');
    expect(imagePart).toEqual({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
    });

    const base64 = imagePart.image_url.url.split(',')[1];
    expect(Array.from(atob(base64), (char) => char.charCodeAt(0))).toEqual(
      Array.from(IMAGE_BYTES),
    );
  });

  it('returns bubbles converted to pixels of the page that was sent', async () => {
    fetchMock.mockResolvedValue(chat(BUBBLES));

    const result = await call();

    expect(result).toEqual({
      width: 100,
      height: 200,
      bubbles: [{ box: [10, 20, 50, 100], src: 'こんにちは', dst: '你好', vertical: true }],
    });
  });

  it('rejects a non-200 response with the status code', async () => {
    fetchMock.mockResolvedValue(new Response('upstream failed', { status: 500 }));

    await expect(call()).rejects.toThrow('manga: HTTP 500');
  });

  it('refuses to send the image over plaintext HTTP to a remote host', async () => {
    await expect(
      call({ endpoint: endpoint({ baseUrl: 'http://api.example.com/v1' }) }),
    ).rejects.toThrow('manga: 不允许把图片发送到明文地址');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows plaintext HTTP for a loopback endpoint', async () => {
    fetchMock.mockResolvedValue(chat(BUBBLES));

    await expect(
      call({ endpoint: endpoint({ baseUrl: 'http://127.0.0.1:8790' }) }),
    ).resolves.toMatchObject({ width: 100, height: 200 });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:8790/chat/completions');
  });

  it('serves a repeated page from the cache without a request', async () => {
    fetchMock.mockResolvedValue(chat(BUBBLES));

    const first = await call({ glossary: { 猫: '咪咪' } });
    const second = await call({ glossary: { 猫: '咪咪' } });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the vision model changes', async () => {
    // A fresh Response per call: a body can only be consumed once.
    fetchMock.mockImplementation(() => Promise.resolve(chat(BUBBLES)));

    await call();
    await call({ endpoint: endpoint({ model: 'vision-2' }) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty model response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await expect(call()).rejects.toThrow('manga: 模型响应为空');
  });
});
