// Doubao (Volcano Engine / 火山引擎) speech synthesis as a SpeechProvider:
// POST https://openspeech.bytedance.com/api/v1/tts with the user's own App ID
// and Access Token. The service returns one base64 MP3 for the whole request
// and no word timings, so highlighting stays at sentence granularity.

import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { SystemSettings } from '@/types/settings';
import { DOUBAO_VOICES } from '../doubaoVoices';
import type { TTSVoice, TTSVoicesGroup } from '../types';
import {
  type SpeechProvider,
  SpeechSynthesisPermanentError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from './types';

export const DOUBAO_PROVIDER_ID = 'doubao-tts';
export const DOUBAO_TTS_URL = 'https://openspeech.bytedance.com/api/v1/tts';
export const DEFAULT_DOUBAO_CLUSTER = 'volcano_tts';

// A successful synthesis carries this protocol code; anything else is a
// refusal (quota, invalid voice, bad token) that will not succeed on retry.
export const DOUBAO_SUCCESS_CODE = 3000;

const REQUEST_TIMEOUT_MS = 30_000;

export interface DoubaoConfig {
  appId: string;
  accessToken: string;
  cluster: string;
}

interface DoubaoResponse {
  code?: number;
  message?: string;
  data?: string;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

// Settings → SystemSettings holds the credentials; a blank App ID or token
// means the engine is not configured. The cluster falls back to the public
// text-to-speech cluster so an older settings file still works.
export const readDoubaoConfig = (
  settings: Partial<SystemSettings> | null | undefined,
): DoubaoConfig | null => {
  const appId = settings?.ttsDoubaoAppId?.trim() ?? '';
  const accessToken = settings?.ttsDoubaoAccessToken?.trim() ?? '';
  if (!appId || !accessToken) return null;
  return {
    appId,
    accessToken,
    cluster: settings?.ttsDoubaoCluster?.trim() || DEFAULT_DOUBAO_CLUSTER,
  };
};

const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

export class DoubaoSpeechProvider implements SpeechProvider {
  readonly id = DOUBAO_PROVIDER_ID;
  readonly label = 'Doubao TTS';
  readonly cacheable = true;

  // `getConfig` is injected: the provider never caches credentials the reader
  // just cleared, and the transport module stays free of store imports.
  constructor(private readonly getConfig: () => DoubaoConfig | null) {}

  async init(): Promise<boolean> {
    return this.getConfig() !== null;
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return DOUBAO_VOICES.map(({ id, name, description, lang, gender }) => ({
      id,
      name,
      description,
      lang,
      gender,
    }));
  }

  // One group, displayed in Chinese in the picker.
  groupVoices(voices: TTSVoice[]): Omit<TTSVoicesGroup, 'disabled'>[] {
    return [{ id: this.id, name: '豆包语音', voices }];
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    return voices[0]?.id;
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const config = this.getConfig();
    if (!config) throw new SpeechSynthesisPermanentError('doubao: 未配置豆包语音凭据');
    if (signal.aborted) throw abortError();
    const cluster = config.cluster?.trim() || DEFAULT_DOUBAO_CLUSTER;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let body: DoubaoResponse;
    try {
      const res = await getAIFetch()(DOUBAO_TTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Volcano's protocol requires the semicolon after `Bearer`.
          Authorization: `Bearer; ${config.accessToken}`,
        },
        body: JSON.stringify({
          app: { appid: config.appId, token: config.accessToken, cluster },
          user: { uid: 'readest' },
          audio: { voice_type: req.voice, encoding: 'mp3', rate: 24000 },
          request: {
            reqid:
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            text: req.text,
            operation: 'query',
            speed_ratio: 1.0,
            volume_ratio: 1.0,
            pitch_ratio: 1.0,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`doubao: HTTP ${res.status}`);
      body = (await res.json()) as DoubaoResponse;
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (timedOut) throw new Error('doubao: 请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    if (body.code !== DOUBAO_SUCCESS_CODE) {
      throw new SpeechSynthesisPermanentError(`doubao: ${body.message || '合成失败'}`);
    }
    if (!body.data) throw new SpeechSynthesisPermanentError('doubao: 合成失败');

    return { audio: decodeBase64(body.data), boundaries: [] };
  }
}
