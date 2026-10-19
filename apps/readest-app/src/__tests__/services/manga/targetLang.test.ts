import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildVisionPrompt } from '@/services/manga/visionPrompt';
import { resetMangaCacheForTests } from '@/services/manga/mangaCache';
import { translateMangaPage } from '@/services/manga/translateMangaPage';
import {
  MANGA_TARGET_LANG,
  normalizeMangaTargetLang,
  type MangaVisionEndpoint,
} from '@/services/manga/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x11]);
const IMAGE = IMAGE_BYTES.buffer;

const endpoint: MangaVisionEndpoint = {
  baseUrl: 'https://vision.example.com/v1',
  model: 'vision-1',
};

const chat = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { box: [0.1, 0.1, 0.5, 0.5], src: 'こんにちは', dst: 'Hello', vertical: true },
            ]),
          },
        },
      ],
    }),
    { status: 200 },
  );

const call = (targetLang?: string) =>
  translateMangaPage({
    image: IMAGE,
    mimeType: 'image/png',
    width: 100,
    height: 200,
    endpoint,
    targetLang,
  });

const promptOf = (index: number): string => {
  const init = fetchMock.mock.calls[index]![1] as { body: string };
  const body = JSON.parse(init.body) as {
    messages: Array<{ content: Array<{ type: string; text: string }> }>;
  };
  return body.messages[0]!.content[0]!.text;
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(chat()));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('indexedDB', undefined);
  resetMangaCacheForTests();
});

afterEach(() => {
  resetMangaCacheForTests();
  vi.unstubAllGlobals();
});

describe('manga target language', () => {
  it('defaults to Simplified Chinese', () => {
    expect(MANGA_TARGET_LANG).toBe('zh-Hans');
    expect(normalizeMangaTargetLang(undefined)).toBe('zh-Hans');
    expect(normalizeMangaTargetLang('zh-Hant')).toBe('zh-Hans');

    const prompt = buildVisionPrompt();
    expect(prompt).toContain('翻译成简体中文');
    expect(buildVisionPrompt({ targetLang: 'zh-Hans' })).toBe(prompt);
  });

  it('builds an English prompt for English targets', () => {
    expect(normalizeMangaTargetLang('en-US')).toBe('en');

    const prompt = buildVisionPrompt({ targetLang: 'en-GB' });
    expect(prompt).toContain('translate that text into English');
    expect(prompt).toContain('normalized coordinates');
    expect(prompt).not.toContain('翻译成简体中文');
  });

  it('builds a Japanese prompt for Japanese targets', () => {
    expect(normalizeMangaTargetLang('ja-JP')).toBe('ja');

    const prompt = buildVisionPrompt({ targetLang: 'ja' });
    expect(prompt).toContain('日本語に翻訳');
    expect(prompt).toContain('正規化座標');
    expect(prompt).not.toContain('翻译成简体中文');
  });

  it('scopes the cache key by target language instead of sharing one entry', async () => {
    await call('en');
    await call('en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(promptOf(0)).toContain('translate that text into English');

    await call('zh-Hans');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toContain('翻译成简体中文');

    await call('ja');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(promptOf(2)).toContain('日本語に翻訳');

    // The default resolves to the same Simplified Chinese entry as an
    // explicit zh-Hans request, so it is served from cache.
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
