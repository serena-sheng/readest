import { EdgeSpeechProvider } from './providers/edge';
import { getVoicePreviewText } from './voiceMeta';
import type { TTSVoice, TTSVoicesGroup } from './types';

export interface VoicePreviewHandle {
  stop: () => void;
}

// Book narration and user-configured OpenAI services cannot produce a
// one-off sample here, so their rows do not offer a preview button.
export const isVoicePreviewSupported = (group: TTSVoicesGroup): boolean =>
  group.id !== 'media-overlay' && !group.id.startsWith('custom-tts:');

// System voices: the OS synthesizes directly through the Web Speech API, and
// the utterance is matched to the voice the picker listed.
const startSystemPreview = (voice: TTSVoice, onEnd: () => void): VoicePreviewHandle => {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
  if (!synth || !Utterance) {
    queueMicrotask(onEnd);
    return { stop: () => {} };
  }

  const utterance = new Utterance(getVoicePreviewText(voice.lang));
  utterance.lang = voice.lang;
  const match = synth
    .getVoices()
    .find((candidate) => candidate.voiceURI === voice.id || candidate.name === voice.name);
  if (match) utterance.voice = match;

  let stopped = false;
  utterance.onend = () => {
    if (!stopped) onEnd();
  };
  utterance.onerror = () => {
    if (!stopped) onEnd();
  };

  synth.cancel();
  synth.speak(utterance);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      synth.cancel();
    },
  };
};

// Edge voices are synthesized server-side and played through one throwaway
// audio element, so a preview never touches the reader's TTS session.
const startEdgePreview = (voice: TTSVoice, onEnd: () => void): VoicePreviewHandle => {
  const abort = new AbortController();
  let audio: HTMLAudioElement | null = null;
  let stopped = false;

  void (async () => {
    try {
      const provider = new EdgeSpeechProvider();
      if (!(await provider.init('wss')) || abort.signal.aborted) throw new Error('unavailable');
      const { audio: data } = await provider.synthesize(
        {
          lang: voice.lang,
          text: getVoicePreviewText(voice.lang),
          voice: voice.id,
          pitch: 1,
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
      const element = new Audio(url);
      audio = element;
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (!stopped) {
          stopped = true;
          onEnd();
        }
      };
      element.onended = cleanup;
      element.onerror = cleanup;
      abort.signal.addEventListener(
        'abort',
        () => {
          element.pause();
          URL.revokeObjectURL(url);
        },
        { once: true },
      );
      await element.play();
    } catch {
      if (!stopped) {
        stopped = true;
        onEnd();
      }
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      abort.abort();
      audio?.pause();
      audio = null;
    },
  };
};

export const startVoicePreview = (
  group: TTSVoicesGroup,
  voice: TTSVoice,
  onEnd: () => void,
): VoicePreviewHandle =>
  group.id === 'edge-tts' ? startEdgePreview(voice, onEnd) : startSystemPreview(voice, onEnd);
