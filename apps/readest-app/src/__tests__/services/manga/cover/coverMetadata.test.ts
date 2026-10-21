import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getMangaEndpointMock } = vi.hoisted(() => ({ getMangaEndpointMock: vi.fn() }));

vi.mock('@/services/translators/endpoints', () => ({
  getMangaEndpoint: getMangaEndpointMock,
}));

import {
  COVER_PROMPT,
  extractCoverFields,
  parseCoverFields,
  type CoverEndpoint,
} from '@/services/manga/cover/coverMetadata';

const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x10]);

const FIELDS = {
  title: '夜の図書館',
  artist: 'wataya',
  circle: 'circle-a',
  parody: 'original',
  language: 'japanese',
  tags: ['romance', 'school'],
};

const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const endpointFor = (name: string, withKey = true): CoverEndpoint => ({
  baseUrl: `https://${name}.example.com/v1`,
  model: 'vision-1',
  ...(withKey ? { apiKey: 'sk-test' } : {}),
});

const call = (endpoint: CoverEndpoint | null | undefined) =>
  extractCoverFields({
    image: IMAGE_BYTES,
    mimeType: 'image/png',
    ...(endpoint === undefined ? {} : { endpoint }),
  });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  getMangaEndpointMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extractCoverFields', () => {
  it('posts the fixed cover prompt and the data URL to the chat endpoint', async () => {
    fetchMock.mockResolvedValue(chat(JSON.stringify(FIELDS)));

    const result = await call(endpointFor('shape'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://shape.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'vision-1', temperature: 0, stream: false });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    const [textPart, imagePart] = body.messages[0].content;
    expect(textPart).toEqual({ type: 'text', text: COVER_PROMPT });
    expect(textPart.text).toContain('"title":"作品标题');
    expect(textPart.text).toContain('"tags":["最多 8 个');
    expect(imagePart.type).toBe('image_url');
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
    const base64 = imagePart.image_url.url.split(',')[1];
    expect(Array.from(atob(base64), (char) => char.charCodeAt(0))).toEqual(Array.from(IMAGE_BYTES));

    expect(result).toEqual(FIELDS);
  });

  it('parses an object wrapped in a json fence and prose', async () => {
    fetchMock.mockResolvedValue(
      chat(`提取结果如下：\n\`\`\`json\n${JSON.stringify(FIELDS)}\n\`\`\`\n如需修改请告知。`),
    );

    await expect(call(endpointFor('fenced'))).resolves.toEqual(FIELDS);
  });

  it('fills missing fields with empty values instead of failing', async () => {
    fetchMock.mockResolvedValue(chat('{"title":"Only Title"}'));

    await expect(call(endpointFor('missing'))).resolves.toEqual({
      title: 'Only Title',
      artist: '',
      circle: '',
      parody: '',
      language: '',
      tags: [],
    });
  });

  it('keeps at most eight string tags', async () => {
    fetchMock.mockResolvedValue(
      chat(
        JSON.stringify({
          ...FIELDS,
          tags: ['a', 7, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        }),
      ),
    );

    const result = await call(endpointFor('tags'));

    expect(result?.tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('returns null for an unparseable reply', async () => {
    fetchMock.mockResolvedValue(chat('对不起，我无法识别这张图片。'));

    await expect(call(endpointFor('invalid'))).resolves.toBeNull();
  });

  it('returns null without a request when no endpoint is configured', async () => {
    getMangaEndpointMock.mockReturnValue(null);

    await expect(call(undefined)).resolves.toBeNull();

    expect(getMangaEndpointMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without a request when the caller passes null', async () => {
    await expect(call(null)).resolves.toBeNull();

    expect(getMangaEndpointMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(call(endpointFor('error'))).resolves.toBeNull();
  });

  it('keeps at most two requests in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const pending: Array<() => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.push(() => {
            inFlight -= 1;
            resolve(chat(JSON.stringify(FIELDS)));
          });
        }),
    );

    const calls = ['a', 'b', 'c'].map((name) =>
      extractCoverFields({
        image: IMAGE_BYTES,
        mimeType: 'image/png',
        endpoint: endpointFor(name),
      }),
    );

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(maxInFlight).toBe(2);

    pending.shift()!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    pending.shift()!();
    pending.shift()!();

    await expect(Promise.all(calls)).resolves.toEqual([FIELDS, FIELDS, FIELDS]);
    expect(maxInFlight).toBe(2);
  });
});

describe('parseCoverFields', () => {
  it('normalizes language aliases and tag case', () => {
    expect(parseCoverFields('{"language":"JA","tags":["Romance","romance"," SCHOOL "]}')).toEqual({
      title: '',
      artist: '',
      circle: '',
      parody: '',
      language: 'japanese',
      tags: ['romance', 'school'],
    });
  });

  it('returns null when the reply is not an object', () => {
    expect(parseCoverFields('["title"]')).toBeNull();
    expect(parseCoverFields(null)).toBeNull();
  });
});
