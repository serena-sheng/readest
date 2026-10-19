import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emmProvider } from '@/services/translators/providers/emm';
import {
  saveEndpoint,
  setActiveEndpointId,
  type TranslationEndpoint,
} from '@/services/translators/endpoints';
import { installMemoryStorage } from '../../memoryStorage';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const localEndpoint: TranslationEndpoint = {
  id: 'local',
  name: '本机专家服务',
  kind: 'emm',
  baseUrl: 'http://127.0.0.1:8790',
  enabled: true,
};

const openaiEndpoint = (overrides: Partial<TranslationEndpoint> = {}): TranslationEndpoint => ({
  id: 'cloud',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'sk-test',
  enabled: true,
  ...overrides,
});

const ok = (paragraphs: Array<{ id: number; text: string }>) =>
  new Response(JSON.stringify({ paragraphs }), { status: 200 });

const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  installMemoryStorage();
  window.localStorage.clear();
});

describe('emmProvider with translation endpoints', () => {
  it('keeps the local request shape for kind=emm', async () => {
    saveEndpoint({ ...localEndpoint, baseUrl: 'http://127.0.0.1:9000/' });
    setActiveEndpointId('local');
    fetchMock.mockResolvedValue(ok([{ id: 1, text: '你好' }]));

    const out = await emmProvider.translate(['Hello'], 'en', 'zh-CN');

    expect(out).toEqual(['你好']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:9000/translate');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      style: 'humanities.faithful',
      book: '',
      paragraphs: ['Hello'],
    });
  });

  it('posts a chat completion with the ported prompt for kind=openai-compatible', async () => {
    saveEndpoint(openaiEndpoint());
    setActiveEndpointId('cloud');
    fetchMock.mockResolvedValue(chat('{"paragraphs":[{"id":1,"text":"你好"}]}'));

    const out = await emmProvider.translate(['Hello'], 'en', 'zh-CN');

    expect(out).toEqual(['你好']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0.4,
      stream: false,
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('你是人文社科学术译者');
    expect(body.messages[0].content).toContain('请使用简体中文输出。');
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: expect.stringContaining('<p id="1">Hello</p>'),
    });
    expect(body.messages[1].content).toContain('<task>translate_book_paragraphs</task>');
  });

  it('follows the active style in the system prompt', async () => {
    saveEndpoint(openaiEndpoint());
    setActiveEndpointId('cloud');
    window.localStorage.setItem('emm.translationStyle', 'jp_light.plain');
    fetchMock.mockResolvedValue(chat('{"paragraphs":[{"id":1,"text":"译文"}]}'));

    await emmProvider.translate(['Hello'], 'en', 'zh-CN');

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toContain('你是日本轻小说的译者');
    expect(body.messages[0].content).toContain('长句拆短');
  });

  it('parses JSON fenced in ``` and aligns by id', async () => {
    saveEndpoint(openaiEndpoint());
    setActiveEndpointId('cloud');
    fetchMock.mockResolvedValue(
      chat('```json\n{"paragraphs":[{"id":2,"text":"乙"},{"id":1,"text":"甲"}]}\n```'),
    );

    const out = await emmProvider.translate(['one', 'two'], 'en', 'zh-CN');

    expect(out).toEqual(['甲', '乙']);
  });

  it('throws an emm error when the chat response drops a paragraph', async () => {
    saveEndpoint(openaiEndpoint());
    setActiveEndpointId('cloud');
    fetchMock.mockResolvedValue(chat('{"paragraphs":[{"id":2,"text":"乙"}]}'));

    await expect(emmProvider.translate(['one', 'two'], 'en', 'zh-CN')).rejects.toThrow(
      /^emm: 响应缺少第 1 段/,
    );
  });

  it('rejects non-JSON model content with the emm prefix', async () => {
    saveEndpoint(openaiEndpoint());
    setActiveEndpointId('cloud');
    fetchMock.mockResolvedValue(chat('Sure! Here is the translation.'));

    await expect(emmProvider.translate(['one'], 'en', 'zh-CN')).rejects.toThrow(
      /^emm: 模型响应不是合法 JSON/,
    );
  });

  it('requires a model on an OpenAI-compatible endpoint', async () => {
    saveEndpoint(openaiEndpoint({ model: undefined }));
    setActiveEndpointId('cloud');

    await expect(emmProvider.translate(['one'], 'en', 'zh-CN')).rejects.toThrow(
      /^emm: 端点未配置模型/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
