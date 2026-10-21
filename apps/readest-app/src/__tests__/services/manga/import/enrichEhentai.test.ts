import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EHENTAI_API_URL,
  createEhentaiClient,
  galleryToMetadata,
  parseEhentaiCookies,
} from '@/services/manga/import/enrichEhentai';

/**
 * Minimal `Response` double: the client only reads `ok`, `status` and `json`.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

/** Validates the request body shape the tests rely on. */
function readGidlist(init?: RequestInit): unknown[][] {
  const raw: unknown = JSON.parse(String(init?.body));
  if (!raw || typeof raw !== 'object' || !('gidlist' in raw) || !Array.isArray(raw.gidlist)) {
    throw new Error('request body is missing gidlist');
  }
  return raw.gidlist as unknown[][];
}

function galleryPayload(gids: readonly string[]): unknown {
  return {
    gmetadata: gids.map((gid) => ({
      gid: Number(gid),
      token: `token-${gid}`,
      title: `Work ${gid}`,
      title_jpn: `作品 ${gid}`,
      category: 'Artist CG',
      uploader: 'someone',
      posted: '2026-10-18 18:08',
      filecount: '12',
      rating: '4.5',
      thumb: 'https://ehgt.org/x.webp',
      tags: ['language:english', 'language:translated', 'artist:wataya', 'male:anal'],
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createEhentaiClient', () => {
  it('sends the documented gdata request shape with auth cookies', async () => {
    const payload = galleryPayload(['4264785']);
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    const client = createEhentaiClient({
      fetch: fetchMock,
      cookies: { ipb_member_id: '1', ipb_pass_hash: 'hash' },
    });

    const result = await client.fetchMetadata([{ gid: '4264785', token: '97f2cdbfa3' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe(EHENTAI_API_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Cookie: 'ipb_member_id=1; ipb_pass_hash=hash',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      method: 'gdata',
      gidlist: [[4264785, '97f2cdbfa3']],
      namespace: 1,
    });

    expect(result.failed).toEqual([]);
    expect(result.galleries).toHaveLength(1);
    expect(result.galleries[0]).toMatchObject({
      gid: '4264785',
      title: 'Work 4264785',
      titleJpn: '作品 4264785',
      category: 'Artist CG',
      uploader: 'someone',
      posted: '2026-10-18 18:08',
      pages: 12,
      rating: 4.5,
      tags: ['language:english', 'language:translated', 'artist:wataya', 'male:anal'],
    });
  });

  it('batches at 25 galleries per request', async () => {
    const batchSizes: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const gids = readGidlist(init);
      batchSizes.push(gids.length);
      return jsonResponse({
        gmetadata: gids.map(([gid, token]) => ({ gid, token, title: `Work ${String(gid)}` })),
      });
    });
    const client = createEhentaiClient({
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
    });
    const refs = Array.from({ length: 60 }, (_, index) => ({
      gid: String(4_000_000 + index),
      token: `token-${index}`,
    }));

    const result = await client.fetchMetadata(refs);

    expect(batchSizes).toEqual([25, 25, 10]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.galleries).toHaveLength(60);
    expect(result.failed).toEqual([]);
  });

  it('degrades without throwing on network and per-gallery errors', async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      call += 1;
      if (call === 1) throw new Error('network down');
      return jsonResponse({
        gmetadata: [{ gid: 2, token: 'token-b', error: 'No gallery found' }],
      });
    });
    const client = createEhentaiClient({
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      maxBatchSize: 1,
    });

    const result = await client.fetchMetadata([
      { gid: '1', token: 'token-a' },
      { gid: '2', token: 'token-b' },
    ]);

    expect(result.galleries).toEqual([]);
    expect(result.failed).toEqual([
      { gid: '1', token: 'token-a', error: 'network down' },
      { gid: '2', token: 'token-b', error: 'No gallery found' },
    ]);
  });

  it('waits 3 seconds between consecutive requests', async () => {
    vi.useFakeTimers();
    const timestamps: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      timestamps.push(Date.now());
      const gids = readGidlist(init);
      return jsonResponse({
        gmetadata: gids.map(([gid, token]) => ({ gid, token, title: `Work ${String(gid)}` })),
      });
    });
    const client = createEhentaiClient({ fetch: fetchMock, maxBatchSize: 1 });

    const pending = client.fetchMetadata([
      { gid: '1', token: 'token-a' },
      { gid: '2', token: 'token-b' },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual([]);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBe(3000);
  });

  it('records HTTP failures per batch without losing successful batches', async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ error: 'busy' }, 500)
        : jsonResponse(galleryPayload(['2']));
    });
    const client = createEhentaiClient({
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      maxBatchSize: 1,
    });

    const result = await client.fetchMetadata([
      { gid: '1', token: 'token-a' },
      { gid: '2', token: 'token-b' },
    ]);

    expect(result.galleries).toHaveLength(1);
    expect(result.galleries[0]?.gid).toBe('2');
    expect(result.failed).toEqual([{ gid: '1', token: 'token-a', error: 'E-Hentai API HTTP 500' }]);
  });
});

describe('galleryToMetadata', () => {
  it('maps a gallery to schema-1 metadata without inventing a description', () => {
    const metadata = galleryToMetadata(
      {
        gid: '4264785',
        token: '97f2cdbfa3',
        title: 'Dansei shikkaku',
        titleJpn: '男性失格',
        category: 'Artist CG',
        uploader: 'dawei123',
        posted: '2026-10-18 18:08',
        rating: 2.41,
        pages: 438,
        tags: ['language:english', 'group:trans tribune', 'artist:wataya'],
        thumb: 'https://ehgt.org/x.webp',
      },
      '2026-10-21T12:00:00Z',
    );

    expect(metadata).toMatchObject({
      schema: 1,
      source: 'e-hentai',
      gid: 4264785,
      token: '97f2cdbfa3',
      url: 'https://e-hentai.org/g/4264785/97f2cdbfa3/',
      title: 'Dansei shikkaku',
      title_jpn: '男性失格',
      category: 'Artist CG',
      uploader: 'dawei123',
      rating: 2.41,
      pages: 438,
      language: ['english'],
      description: '',
      description_source: 'e-hentai:none',
      fetched_at: '2026-10-21T12:00:00Z',
    });
  });
});

describe('parseEhentaiCookies', () => {
  it('accepts a name/value map and a browser cookie list, filtered by domain', () => {
    expect(parseEhentaiCookies({ ipb_member_id: '1', sk: '' })).toEqual({ ipb_member_id: '1' });

    expect(
      parseEhentaiCookies([
        { name: 'ipb_member_id', value: '1', domain: '.e-hentai.org' },
        { name: 'igneous', value: 'abc', domain: 'exhentai.org' },
        { name: 'unrelated', value: 'nope', domain: '.example.com' },
      ]),
    ).toEqual({ ipb_member_id: '1', igneous: 'abc' });

    expect(parseEhentaiCookies([])).toBeNull();
    expect(parseEhentaiCookies('nope')).toBeNull();
  });
});
