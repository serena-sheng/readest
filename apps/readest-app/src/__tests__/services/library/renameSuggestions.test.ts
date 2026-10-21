import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getActiveEndpoint } from '@/services/translators/endpoints';
import type { TranslationEndpoint } from '@/services/translators/endpoints';
import {
  RENAME_BATCH_SIZE,
  RENAME_PROMPT,
  suggestBookTitles,
  type RenameBookInput,
} from '@/services/library/renameSuggestions';

vi.mock('@/services/translators/endpoints', () => ({ getActiveEndpoint: vi.fn() }));

const getActiveEndpointMock = vi.mocked(getActiveEndpoint);

const endpoint: TranslationEndpoint = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1/',
  model: 'deepseek-chat',
  apiKey: 'sk-test',
  enabled: true,
};

const book = (index: number, title = `Book ${index}`): RenameBookInput => ({
  hash: `hash-${index}`,
  title,
  author: 'Author',
  language: 'ja',
});

const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  getActiveEndpointMock.mockReturnValue(endpoint);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('suggestBookTitles', () => {
  test('posts the fixed prompt and the batch to the chat endpoint', async () => {
    fetchMock.mockResolvedValue(
      reply('[{"i":1,"title":"书名一","why":"译名"},{"i":2,"title":"书名二","why":"译名"}]'),
    );

    const result = await suggestBookTitles([book(1, 'Book One'), book(2, 'Book Two')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages[0]).toEqual({ role: 'system', content: RENAME_PROMPT });
    expect(RENAME_PROMPT).toContain('日语/罗马音/英语一律译成汉语');
    expect(RENAME_PROMPT).toContain('不超过 24 个汉字');
    expect(RENAME_PROMPT).toContain('只输出 JSON 数组');
    expect(body.messages[1].content).toContain('1. Book One');
    expect(body.messages[1].content).toContain('2. Book Two');

    expect(result.map((item) => item.suggestedTitle)).toEqual(['书名一', '书名二']);
    expect(result[0]).toMatchObject({ hash: 'hash-1', currentTitle: 'Book One', reason: '译名' });
  });

  test('splits a library into batches of 20 and requests them serially', async () => {
    const books = Array.from({ length: 25 }, (_, index) => book(index + 1));
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const count = body.messages[1].content.split('\n').length;
      return reply(
        JSON.stringify(
          Array.from({ length: count }, (_, index) => ({
            i: index + 1,
            title: `译${index + 1}`,
            why: '',
          })),
        ),
      );
    });

    const result = await suggestBookTitles(books);

    expect(RENAME_BATCH_SIZE).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(secondBody.messages[1].content.split('\n')).toHaveLength(5);
    expect(result).toHaveLength(25);
    expect(result[19]!.suggestedTitle).toBe('译20');
    expect(result[20]!.suggestedTitle).toBe('译1');
  });

  test('parses a JSON array wrapped in a code fence and prose', async () => {
    fetchMock.mockResolvedValue(
      reply(
        '好的，结果如下：\n```json\n[{"i":1,"title":"孤独摇滚","why":"通行译名"}]\n```\n希望有帮助',
      ),
    );

    const [candidate] = await suggestBookTitles([book(1, 'ぼっち・ざ・ろっく！')]);

    expect(candidate!.suggestedTitle).toBe('孤独摇滚');
    expect(candidate!.reason).toBe('通行译名');
  });

  test('falls back to the current title for items the model omitted and truncates why to 60 chars', async () => {
    const longReason = '理'.repeat(80);
    fetchMock.mockResolvedValue(
      reply(JSON.stringify([{ i: 1, title: '第一本', why: longReason }])),
    );

    const result = await suggestBookTitles([book(1, 'First'), book(2, 'Second')]);

    expect(result[0]!.suggestedTitle).toBe('第一本');
    expect(result[0]!.reason).toHaveLength(60);
    expect(result[1]).toEqual({
      hash: 'hash-2',
      currentTitle: 'Second',
      suggestedTitle: 'Second',
      reason: '',
    });
  });

  test('returns [] when no usable endpoint is configured', async () => {
    const none = await suggestBookTitles([book(1)], { endpoint: null });
    expect(none).toEqual([]);

    getActiveEndpointMock.mockReturnValue({ ...endpoint, model: undefined });
    const withoutModel = await suggestBookTitles([book(1)]);
    expect(withoutModel).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('degrades a failed request to the current titles', async () => {
    fetchMock.mockResolvedValue(new Response('upstream error', { status: 500 }));

    const result = await suggestBookTitles([book(1, 'First'), book(2, 'Second')]);

    expect(result).toEqual([
      {
        hash: 'hash-1',
        currentTitle: 'First',
        suggestedTitle: 'First',
        reason: '未能获取建议',
      },
      {
        hash: 'hash-2',
        currentTitle: 'Second',
        suggestedTitle: 'Second',
        reason: '未能获取建议',
      },
    ]);
  });

  test('degrades a network rejection and reports batch progress', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply('[{"i":1,"title":"译名","why":""}]'));
    const onProgress = vi.fn();

    const result = await suggestBookTitles(
      Array.from({ length: 21 }, (_, i) => book(i + 1)),
      {
        onProgress,
      },
    );

    expect(result).toHaveLength(21);
    expect(result[0]!.reason).toBe('未能获取建议');
    expect(result[20]!.suggestedTitle).toBe('译名');
    expect(onProgress).toHaveBeenNthCalledWith(1, 20, 21);
    expect(onProgress).toHaveBeenNthCalledWith(2, 21, 21);
  });
});
