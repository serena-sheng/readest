import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteNote, listNotes, saveNote } from '@/services/ai/localNotes';

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

describe('localNotes', () => {
  it('lists the notes of one book, newest first', async () => {
    const notes = [
      {
        id: 2,
        uuid: 'note-2',
        quote: '第二段引文',
        note: '新的想法',
        locator: 'ch1.xhtml#1',
        created_at: 1760000000,
      },
      {
        id: 1,
        uuid: 'note-1',
        quote: '第一段引文',
        note: '',
        locator: 'ch1.xhtml#0',
        created_at: 1759000000,
      },
    ];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ notes }) });

    await expect(listNotes('往事与随想')).resolves.toEqual(notes);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://127.0.0.1:8790/notes?book=${encodeURIComponent('往事与随想')}`);
    expect(init).toBeUndefined();
  });

  it('returns an empty list when the book has no notes', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ notes: [] }) });

    await expect(listNotes('没有想法的书')).resolves.toEqual([]);
  });

  it('posts a note', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });

    const input = {
      book: '往事与随想',
      quote: '一段引文',
      note: '一段想法',
      locator: 'ch1.xhtml#1',
    };
    await expect(saveNote(input)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/notes');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('deletes a note by uuid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, deleted: true }),
    });

    await expect(deleteNote('note-7')).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/notes?uuid=note-7');
    expect(init.method).toBe('DELETE');
  });

  it('throws a prefixed error on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(listNotes('往事与随想')).rejects.toThrow('local-notes: request failed (500)');
    await expect(deleteNote('note-7')).rejects.toThrow('local-notes: request failed (500)');
  });

  it('throws a prefixed error when the service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8790'));

    await expect(saveNote({ book: 'b', quote: 'q', note: '', locator: '' })).rejects.toThrow(
      'local-notes: connect ECONNREFUSED 127.0.0.1:8790',
    );
  });

  it('throws a prefixed error when the response has no notes array', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => null });

    await expect(listNotes('往事与随想')).rejects.toThrow('local-notes: invalid notes payload');
  });
});
