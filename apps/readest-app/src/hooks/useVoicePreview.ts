import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoicePreview, type VoicePreviewHandle } from '@/services/tts/voicePreview';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';

const previewKey = (group: TTSVoicesGroup, voice: TTSVoice) => `${group.id}:${voice.id}`;

// One preview at a time across every picker. Clicking the sounding voice
// stops it; clicking another switches, so a 3-second-old sample can be
// replayed or replaced without waiting.
export const useVoicePreview = () => {
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const handleRef = useRef<VoicePreviewHandle | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPreviewingKey(null);
  }, []);

  const toggle = useCallback(
    (group: TTSVoicesGroup, voice: TTSVoice) => {
      const key = previewKey(group, voice);
      if (previewingKey === key) {
        stop();
        return;
      }
      handleRef.current?.stop();
      const onEnd = () => {
        setPreviewingKey((current) => (current === key ? null : current));
        if (handleRef.current === handle) handleRef.current = null;
      };
      let handle: VoicePreviewHandle;
      handle = startVoicePreview(group, voice, onEnd);
      handleRef.current = handle;
      setPreviewingKey(key);
    },
    [previewingKey, stop],
  );

  useEffect(() => stop, [stop]);

  return { previewingKey, toggle, stop };
};
