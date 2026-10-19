import { WebSpeechClient } from './WebSpeechClient';
import { EdgeSpeechProvider } from './providers/edge';
import { TTSUtils } from './TTSUtils';
import { filterVoiceGroups } from './voiceAvailability';
import type { TTSVoice, TTSVoicesGroup } from './types';

// Settings → Voices lists system and Edge voices without starting a TTS
// session. Both clients are cached: the Web Speech voice list can take a
// couple of seconds to populate, and the Edge catalog is a static table.
let webVoicesPromise: Promise<TTSVoice[]> | null = null;

const loadWebVoices = (): Promise<TTSVoice[]> => {
  webVoicesPromise ??= (async () => {
    const client = new WebSpeechClient();
    await client.init();
    return client.getAllVoices();
  })().catch(() => []);
  return webVoicesPromise;
};

export const loadLocalVoiceGroups = async (): Promise<TTSVoicesGroup[]> => {
  const [webVoices, edgeVoices] = await Promise.all([
    loadWebVoices(),
    new EdgeSpeechProvider().getAllVoices(),
  ]);
  return filterVoiceGroups([
    {
      id: 'web-speech-api',
      name: 'Web TTS',
      voices: webVoices.sort(TTSUtils.sortVoicesFunc),
      disabled: webVoices.length === 0,
    },
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      voices: [...edgeVoices].sort(TTSUtils.sortVoicesFunc),
    },
  ]);
};
