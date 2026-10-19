import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSLATION_ENDPOINT,
  deleteEndpoint,
  getActiveEndpoint,
  getActiveEndpointId,
  getMangaEndpoint,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TranslationEndpoint,
} from '@/services/translators/endpoints';
import { installMemoryStorage } from '../../memoryStorage';

const ENDPOINTS_KEY = 'emm.translation.endpoints';

const endpoint = (overrides: Partial<TranslationEndpoint> = {}): TranslationEndpoint => ({
  id: 'local',
  name: '本机专家服务',
  kind: 'emm',
  baseUrl: 'http://127.0.0.1:8790',
  enabled: true,
  ...overrides,
});

beforeEach(() => {
  installMemoryStorage();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('translation endpoints', () => {
  it('falls back to the built-in local expert service when nothing is configured', () => {
    expect(listEndpoints()).toEqual([]);
    expect(getActiveEndpoint()).toMatchObject({
      kind: 'emm',
      baseUrl: 'http://127.0.0.1:8790',
      name: '本机专家服务',
      enabled: true,
    });
    expect(getActiveEndpoint()).toEqual(DEFAULT_TRANSLATION_ENDPOINT);
  });

  it('saves, updates and deletes endpoints', () => {
    saveEndpoint(endpoint());
    saveEndpoint(
      endpoint({
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
      }),
    );

    expect(listEndpoints().map((item) => item.id)).toEqual(['local', 'deepseek']);

    saveEndpoint(endpoint({ name: '本机服务（改）' }));
    expect(listEndpoints()).toHaveLength(2);
    expect(listEndpoints()[0]!.name).toBe('本机服务（改）');

    deleteEndpoint('local');
    expect(listEndpoints().map((item) => item.id)).toEqual(['deepseek']);
  });

  it('switches the active endpoint and ignores a stale active id', () => {
    saveEndpoint(endpoint());
    saveEndpoint(endpoint({ id: 'cloud', kind: 'openai-compatible', baseUrl: 'https://x/v1' }));

    setActiveEndpointId('cloud');
    expect(getActiveEndpointId()).toBe('cloud');
    expect(getActiveEndpoint().id).toBe('cloud');

    setActiveEndpointId('deleted');
    // A stale id falls back to the first enabled endpoint.
    expect(getActiveEndpoint().id).toBe('local');
  });

  it('skips disabled endpoints when resolving the active one', () => {
    saveEndpoint(endpoint({ id: 'off', enabled: false }));
    saveEndpoint(endpoint({ id: 'on' }));

    expect(getActiveEndpoint().id).toBe('on');
  });

  it('clears the active id when that endpoint is deleted', () => {
    saveEndpoint(endpoint());
    setActiveEndpointId('local');

    deleteEndpoint('local');

    expect(getActiveEndpointId()).toBeNull();
    expect(getActiveEndpoint()).toEqual(DEFAULT_TRANSLATION_ENDPOINT);
  });

  it('degrades to an empty list on invalid JSON', () => {
    window.localStorage.setItem(ENDPOINTS_KEY, '{not json');
    expect(listEndpoints()).toEqual([]);
    expect(getActiveEndpoint()).toEqual(DEFAULT_TRANSLATION_ENDPOINT);
  });

  it('drops malformed entries instead of failing the whole list', () => {
    window.localStorage.setItem(
      ENDPOINTS_KEY,
      JSON.stringify([
        endpoint(),
        { id: 'bad', name: 'Bad', kind: 'unknown', baseUrl: 'https://x' },
        null,
      ]),
    );

    expect(listEndpoints().map((item) => item.id)).toEqual(['local']);
    expect(window.localStorage.getItem(ENDPOINTS_KEY)).not.toBeNull();
  });

  it('does not throw when storage itself rejects writes', () => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error('quota');
    };

    expect(() => saveEndpoint(endpoint())).not.toThrow();

    window.localStorage.setItem = original;
    expect(getActiveEndpoint()).toEqual(DEFAULT_TRANSLATION_ENDPOINT);
  });

  it('resolves a manga endpoint only when a vision model is configured', () => {
    expect(getMangaEndpoint()).toBeNull();

    saveEndpoint(endpoint());
    expect(getMangaEndpoint()).toBeNull();

    saveEndpoint(
      endpoint({
        id: 'vision',
        kind: 'openai-compatible',
        baseUrl: 'https://vision.example.com/v1/',
        model: 'text-1',
        visionModel: ' vision-1 ',
        apiKey: ' sk-test ',
      }),
    );

    expect(getMangaEndpoint()).toEqual({
      baseUrl: 'https://vision.example.com/v1',
      model: 'vision-1',
      apiKey: 'sk-test',
    });
  });

  it('prefers the active vision endpoint and ignores disabled ones', () => {
    saveEndpoint(
      endpoint({
        id: 'a',
        kind: 'openai-compatible',
        baseUrl: 'https://a.example.com/v1',
        visionModel: 'va',
      }),
    );
    saveEndpoint(
      endpoint({
        id: 'b',
        kind: 'openai-compatible',
        baseUrl: 'https://b.example.com/v1',
        visionModel: 'vb',
      }),
    );
    saveEndpoint(endpoint({ id: 'off', visionModel: 'vo', enabled: false }));

    expect(getMangaEndpoint()!.model).toBe('va');

    setActiveEndpointId('b');
    expect(getMangaEndpoint()!.model).toBe('vb');

    // The active id points at a disabled endpoint: the first enabled vision
    // endpoint wins instead.
    setActiveEndpointId('off');
    expect(getMangaEndpoint()!.model).toBe('va');
  });
});
