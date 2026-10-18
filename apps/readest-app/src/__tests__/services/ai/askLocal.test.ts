import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askLocal, LOCAL_AI_BASE_URL, suggestLocal } from '@/services/ai/askLocal';

const fetchMock = vi.fn();

const sseResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

beforeEach(() => {
  fetchMock.mockReset();
  Object.defineProperty(window, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('askLocal', () => {
  it('joins SSE deltas across arbitrary chunk boundaries and resolves on done', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"delta":"你',
        '好"}\n\ndata: {"delta":"，世界"}\n',
        '\ndata: {"done":true}\n\n',
      ]),
    );
    const deltas: string[] = [];

    await askLocal({
      question: '这是什么？',
      selection: '一段正文',
      title: '一本书',
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas.join('')).toBe('你好，世界');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${LOCAL_AI_BASE_URL}/ask`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      question: '这是什么？',
      selection: '一段正文',
      title: '一本书',
    });
  });

  it('rejects when the service sends an error event', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":"half"}\n\n', 'data: {"error":"模型不可用"}\n\n']),
    );

    await expect(
      askLocal({ question: 'q', selection: '', title: 't', onDelta: () => {} }),
    ).rejects.toThrow('local-ai: 模型不可用');
  });

  it('rejects with a local-ai error when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(
      askLocal({ question: 'q', selection: '', title: 't', onDelta: () => {} }),
    ).rejects.toThrow('local-ai: connection refused');
  });

  it('rejects on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 502 }));

    await expect(
      askLocal({ question: 'q', selection: '', title: 't', onDelta: () => {} }),
    ).rejects.toThrow('local-ai: ask failed (502)');
  });
});

describe('suggestLocal', () => {
  it('returns the suggestions the service sends', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        suggestions: [
          { question: '主角为什么离开？', label: '主角动机' },
          { question: '这一章讲了什么？', label: '章節概要' },
        ],
      }),
    );

    const suggestions = await suggestLocal({ text: '一段正文', title: '一本书' });

    expect(suggestions).toEqual([
      { question: '主角为什么离开？', label: '主角动机' },
      { question: '这一章讲了什么？', label: '章節概要' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${LOCAL_AI_BASE_URL}/suggest`);
    expect(JSON.parse(init.body)).toEqual({ text: '一段正文', title: '一本书' });
  });

  it('rejects with a local-ai error when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(suggestLocal({ text: '', title: '一本书' })).rejects.toThrow(
      'local-ai: ECONNREFUSED',
    );
  });

  it('rejects on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 500 }));

    await expect(suggestLocal({ text: '', title: '一本书' })).rejects.toThrow(
      'local-ai: suggest failed (500)',
    );
  });
});
