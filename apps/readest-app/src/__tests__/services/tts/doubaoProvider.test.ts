import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOUBAO_CLUSTER,
  DOUBAO_TTS_URL,
  DoubaoSpeechProvider,
  readDoubaoConfig,
} from '@/services/tts/providers/doubao';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => fetchMock,
}));

const CONFIG = {
  appId: 'app-id',
  accessToken: 'secret-token',
  cluster: 'volcano_tts',
};

const provider = (config = CONFIG) => new DoubaoSpeechProvider(() => config);

const request = {
  lang: 'zh-CN',
  text: '你好，世界。',
  voice: 'zh_female_vv_jupiter_bigtts',
  pitch: 1,
};

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('DoubaoSpeechProvider', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('posts the Volcano request shape with the semicolon-bearing auth header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 3000, data: btoa('audio') }));

    const result = await provider().synthesize(request, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(DOUBAO_TTS_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer; secret-token');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.app).toEqual({
      appid: 'app-id',
      token: 'secret-token',
      cluster: 'volcano_tts',
    });
    expect(body.user).toEqual({ uid: 'readest' });
    expect(body.audio).toEqual({
      voice_type: 'zh_female_vv_jupiter_bigtts',
      encoding: 'mp3',
      rate: 24000,
    });
    expect(body.request).toMatchObject({
      text: '你好，世界。',
      operation: 'query',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    });
    expect(typeof body.request.reqid).toBe('string');
    expect(result.boundaries).toEqual([]);
  });

  it('defaults the cluster to volcano_tts when the setting is blank', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 3000, data: btoa('audio') }));

    await provider({ ...CONFIG, cluster: '' }).synthesize(
      request,
      new AbortController().signal,
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.app.cluster).toBe(DEFAULT_DOUBAO_CLUSTER);
  });

  it('decodes the base64 payload into the mp3 bytes', async () => {
    const mp3 = 'ID3\u0004\u0000';
    fetchMock.mockResolvedValue(jsonResponse({ code: 3000, data: btoa(mp3) }));

    const { audio } = await provider().synthesize(request, new AbortController().signal);

    expect(audio).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(audio)).toBe(mp3);
  });

  it('throws the service message when the protocol code is not 3000', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 3001, message: 'quota exceeded for this voice' }),
    );

    await expect(
      provider().synthesize(request, new AbortController().signal),
    ).rejects.toThrow('doubao: quota exceeded for this voice');
  });

  it('refuses to synthesize without credentials', async () => {
    const unconfigured = new DoubaoSpeechProvider(() => null);

    await expect(
      unconfigured.synthesize(request, new AbortController().signal),
    ).rejects.toThrow('doubao: 未配置豆包语音凭据');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the caller abort signal to the request', async () => {
    let received: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      received = init.signal!;
      received.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
      return promise;
    });

    const controller = new AbortController();
    const pending = provider().synthesize(request, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
    expect(received?.aborted).toBe(true);
  });

  it('reads credentials from settings and applies the default cluster', () => {
    expect(
      readDoubaoConfig({
        ttsDoubaoAppId: ' app ',
        ttsDoubaoAccessToken: ' token ',
        ttsDoubaoCluster: '',
      }),
    ).toEqual({ appId: 'app', accessToken: 'token', cluster: DEFAULT_DOUBAO_CLUSTER });

    expect(readDoubaoConfig({ ttsDoubaoAppId: 'app' })).toBeNull();
  });
});
