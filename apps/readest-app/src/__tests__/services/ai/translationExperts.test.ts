import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMemoryStorage } from '../../memoryStorage';

import {
  bindExpert,
  DEFAULT_STYLE,
  getActiveStyle,
  getExperts,
  getStyles,
  saveExpert,
  setActiveStyle,
  splitStyleId,
  STYLE_STORAGE_KEY,
} from '@/services/ai/translationExperts';

const fetchMock = vi.fn();

const SERVICE = 'http://127.0.0.1:8790';

beforeEach(() => {
  installMemoryStorage();
  fetchMock.mockReset();
  Object.defineProperty(window, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getStyles', () => {
  it('parses the catalog and keeps the service default', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        genres: [
          { id: 'humanities', label: '人文社科', desc: '论证连接、概念精确、引文照译' },
          { id: 'jp_light', label: '日本轻小说', desc: '口语、吐槽、角色口吻' },
        ],
        modes: [
          { id: 'faithful', label: '忠实原文', desc: '贴句子结构', temp: 0.3 },
          { id: 'plain', label: '通俗易懂', desc: '长句拆短', temp: 0.55 },
        ],
        default: 'jp_light.plain',
      }),
    );

    const styles = await getStyles();

    expect(styles.genres.map((genre) => genre.id)).toEqual(['humanities', 'jp_light']);
    expect(styles.modes[1]).toEqual({
      id: 'plain',
      label: '通俗易懂',
      desc: '长句拆短',
      temp: 0.55,
    });
    expect(styles.default).toBe('jp_light.plain');
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVICE}/styles`);
  });

  it('falls back to the built-in style when the payload omits one', async () => {
    fetchMock.mockResolvedValue(Response.json({ genres: [], modes: [] }));

    await expect(getStyles()).resolves.toEqual({ genres: [], modes: [], default: DEFAULT_STYLE });
  });

  it('rejects a payload without genre or mode lists', async () => {
    fetchMock.mockResolvedValue(Response.json({ genres: [] }));

    await expect(getStyles()).rejects.toThrow('experts: invalid styles payload');
  });
});

describe('getExperts', () => {
  it('returns the experts the service stores', async () => {
    const experts = [
      {
        id: 3,
        name: '近代史',
        genre: 'humanities',
        mode: 'faithful',
        glossary_count: 4,
        override_prompt: '',
        temp_override: null,
      },
    ];
    fetchMock.mockResolvedValue(Response.json({ experts }));

    await expect(getExperts()).resolves.toEqual(experts);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVICE}/experts`);
  });

  it('rejects a payload without an experts array', async () => {
    fetchMock.mockResolvedValue(Response.json(null));

    await expect(getExperts()).rejects.toThrow('experts: invalid experts payload');
  });
});

describe('saveExpert', () => {
  it('posts the expert and returns its id and name', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 7, name: '轻小说口语' }));
    const input = {
      name: '轻小说口语',
      genre: 'jp_light',
      mode: 'plain',
      glossary: 'ツンデレ=傲娇',
      override_prompt: '',
    };

    await expect(saveExpert(input)).resolves.toEqual({ id: 7, name: '轻小说口语' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${SERVICE}/experts`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('rejects a response without an expert id', async () => {
    fetchMock.mockResolvedValue(Response.json({ name: '轻小说口语' }));

    await expect(
      saveExpert({ name: '轻小说口语', genre: 'jp_light', mode: 'plain', glossary: '' }),
    ).rejects.toThrow('experts: invalid expert payload');
  });
});

describe('bindExpert', () => {
  it('binds the expert to the book by title', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, expert_id: 7 }));

    await expect(bindExpert('往事与随想', 7)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${SERVICE}/bind`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ book: '往事与随想', expert_id: 7 });
  });

  it('rejects when the service refuses the binding', async () => {
    fetchMock.mockResolvedValue(Response.json({ expert: null }));

    await expect(bindExpert('往事与随想', 7)).rejects.toThrow('experts: bind was rejected');
  });
});

describe('transport failures', () => {
  it('prefixes network failures', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8790'));

    await expect(getExperts()).rejects.toThrow('experts: connect ECONNREFUSED 127.0.0.1:8790');
  });

  it('prefixes a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 500 }));

    await expect(getStyles()).rejects.toThrow('experts: request failed (500)');
  });
});

describe('active style', () => {
  it('reads and writes the key the emm provider consumes', () => {
    expect(getActiveStyle()).toBe(DEFAULT_STYLE);

    setActiveStyle(' jp_light.learn ');

    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe('jp_light.learn');
    expect(getActiveStyle()).toBe('jp_light.learn');
  });

  it('rejects an empty style id instead of clearing the provider key', () => {
    setActiveStyle('humanities.plain');

    expect(() => setActiveStyle('   ')).toThrow('experts: empty style id');
    expect(getActiveStyle()).toBe('humanities.plain');
  });

  it('splits a stored style, falling back to the default pair', () => {
    expect(splitStyleId('jp_light.learn')).toEqual({ genre: 'jp_light', mode: 'learn' });
    expect(splitStyleId('')).toEqual({ genre: 'humanities', mode: 'faithful' });
  });
});
