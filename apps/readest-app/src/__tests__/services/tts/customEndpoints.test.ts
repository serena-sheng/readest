import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteEndpoint,
  getActiveEndpoint,
  getActiveEndpointId,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TTSEndpoint,
} from '@/services/tts/customEndpoints';

const ENDPOINTS_KEY = 'emm.tts.endpoints';

// Node 26 exposes an unavailable global `localStorage`, so stub a real
// in-memory Storage instead of relying on jsdom's.
const createStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
};

const endpoint = (overrides: Partial<TTSEndpoint> = {}): TTSEndpoint => ({
  id: 'local',
  name: 'Local Kokoro',
  baseUrl: 'http://127.0.0.1:8880/v1',
  model: 'kokoro',
  voice: 'af_heart',
  enabled: true,
  ...overrides,
});

describe('customEndpoints', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts empty and round-trips a saved endpoint', () => {
    expect(listEndpoints()).toEqual([]);
    expect(getActiveEndpointId()).toBeNull();

    saveEndpoint(endpoint());

    expect(listEndpoints()).toEqual([endpoint()]);
    expect(getActiveEndpointId()).toBeNull();
  });

  it('keeps one entry per id when saving an edit', () => {
    saveEndpoint(endpoint());
    saveEndpoint(endpoint({ name: 'Home Kokoro', model: 'kokoro-v2', apiKey: 'secret' }));

    expect(listEndpoints()).toEqual([
      endpoint({ name: 'Home Kokoro', model: 'kokoro-v2', apiKey: 'secret' }),
    ]);
  });

  it('defaults enabled to true for an entry missing the flag', () => {
    localStorage.setItem(
      ENDPOINTS_KEY,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          baseUrl: 'https://example.test/v1',
          model: 'tts-1',
          voice: 'alloy',
        },
      ]),
    );

    expect(listEndpoints()).toEqual([endpoint({ id: 'legacy', name: 'Legacy', baseUrl: 'https://example.test/v1', model: 'tts-1', voice: 'alloy' })]);
  });

  it('deletes an endpoint and clears the active id when it was active', () => {
    saveEndpoint(endpoint({ id: 'a' }));
    saveEndpoint(endpoint({ id: 'b' }));
    setActiveEndpointId('a');

    deleteEndpoint('a');

    expect(listEndpoints().map((e) => e.id)).toEqual(['b']);
    expect(getActiveEndpointId()).toBeNull();
  });

  it('switches the active endpoint and keeps that id until changed', () => {
    saveEndpoint(endpoint({ id: 'a' }));
    saveEndpoint(endpoint({ id: 'b', enabled: false }));

    setActiveEndpointId('a');
    expect(getActiveEndpointId()).toBe('a');
    expect(getActiveEndpoint()).toEqual(endpoint({ id: 'a' }));

    setActiveEndpointId('b');
    expect(getActiveEndpointId()).toBe('b');

    setActiveEndpointId(null);
    expect(getActiveEndpointId()).toBeNull();
  });

  it('falls back to the first enabled endpoint when the active one is missing or disabled', () => {
    saveEndpoint(endpoint({ id: 'a' }));
    saveEndpoint(endpoint({ id: 'b', enabled: false }));

    setActiveEndpointId('b');
    expect(getActiveEndpoint()).toEqual(endpoint({ id: 'a' }));
  });

  it('tolerates invalid JSON and drops malformed entries', () => {
    localStorage.setItem(ENDPOINTS_KEY, '{not json');
    expect(listEndpoints()).toEqual([]);

    localStorage.setItem(
      ENDPOINTS_KEY,
      JSON.stringify([{ id: 'missing-fields' }, endpoint({ id: 'valid' }), null]),
    );
    expect(listEndpoints()).toEqual([endpoint({ id: 'valid' })]);
  });

  it('degrades quietly when storage is unavailable', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(listEndpoints()).toEqual([]);
    expect(getActiveEndpointId()).toBeNull();
    expect(getActiveEndpoint()).toBeNull();
    expect(() => saveEndpoint(endpoint())).not.toThrow();
    expect(() => setActiveEndpointId('local')).not.toThrow();
    expect(() => deleteEndpoint('local')).not.toThrow();
  });
});
