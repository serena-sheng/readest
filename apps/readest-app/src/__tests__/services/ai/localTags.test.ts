import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTags, listBooks, queryBooks } from '@/services/ai/localTags';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  Object.defineProperty(window, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('localTags', () => {
  it('lists every tag when no namespace is given', async () => {
    const tags = [
      { namespace: 'female', name: 'big breasts', count: 1 },
      { namespace: 'female', name: 'glasses', count: 4 },
    ];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ tags }) });

    await expect(getTags()).resolves.toEqual(tags);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/library/tags');
    expect(init).toBeUndefined();
  });

  it('encodes the namespace filter', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ tags: [] }) });

    await expect(getTags('big female')).resolves.toEqual([]);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/library/tags?namespace=big%20female');
  });

  it('encodes the filter expression, including $…$ and the exclusion prefix', async () => {
    const books = [
      { id: 1, title: '往事与随想', tags: ['female:big breasts', 'female:glasses'] },
    ];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ books }) });

    await expect(queryBooks('female:$big breasts$ -male:glasses')).resolves.toEqual(books);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://127.0.0.1:8790/library/query?expr=${encodeURIComponent('female:$big breasts$ -male:glasses')}`,
    );
  });

  it('does not request the service for an empty expression', async () => {
    await expect(queryBooks('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists all books for the unfiltered result list', async () => {
    const books = [
      {
        id: 1,
        title: '往事与随想',
        author: '赫尔岑',
        path: 'books/one.epub',
        page_count: 640,
        source: 'local',
        tags: ['female:glasses'],
      },
    ];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ books }) });

    await expect(listBooks()).resolves.toEqual(books);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/library/books');
  });

  it('throws a prefixed error on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(getTags()).rejects.toThrow('tags: request failed (500)');
    await expect(queryBooks('female:glasses')).rejects.toThrow('tags: request failed (500)');
    await expect(listBooks()).rejects.toThrow('tags: request failed (500)');
  });

  it('throws a prefixed error when the service is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getTags()).rejects.toThrow('tags: Failed to fetch');
  });

  it('throws a prefixed error when a payload is missing its array', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await expect(getTags()).rejects.toThrow('tags: invalid tags payload');
    await expect(queryBooks('female:glasses')).rejects.toThrow('tags: invalid books payload');
    await expect(listBooks()).rejects.toThrow('tags: invalid books payload');
  });
});
