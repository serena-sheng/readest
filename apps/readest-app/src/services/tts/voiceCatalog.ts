import { useSettingsStore } from '@/store/settingsStore';
import { LOCAL_UNLOCK } from '@/utils/localUnlock';
import { WebSpeechClient } from './WebSpeechClient';
import { DOUBAO_VOICES } from './doubaoVoices';
import { EdgeSpeechProvider } from './providers/edge';
import { readDoubaoConfig } from './providers/doubao';
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
  // Doubao needs the reader's own credentials; without them the group is not
  // listed at all (the settings panel says what to fill in).
  const doubaoConfigured =
    LOCAL_UNLOCK && readDoubaoConfig(useSettingsStore.getState().settings) !== null;
  const doubaoGroup: TTSVoicesGroup[] = doubaoConfigured
    ? [
        {
          id: 'doubao-tts',
          name: '豆包语音',
          voices: DOUBAO_VOICES.map(({ id, name, description, lang, gender }) => ({
            id,
            name,
            description,
            lang,
            gender,
          })),
        },
      ]
    : [];
  return filterVoiceGroups([
    ...doubaoGroup,
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
