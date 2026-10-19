import { describe, expect, it } from 'vitest';
import { DOUBAO_VOICES } from '@/services/tts/doubaoVoices';
import { DoubaoSpeechProvider } from '@/services/tts/providers/doubao';

describe('doubaoVoices', () => {
  it('offers at least six hand-picked listening voices', () => {
    expect(DOUBAO_VOICES.length).toBeGreaterThanOrEqual(6);
  });

  it('describes every voice with an id, name and one-line note', () => {
    for (const voice of DOUBAO_VOICES) {
      expect(voice.id.trim()).not.toBe('');
      expect(voice.name.trim()).not.toBe('');
      expect(voice.description.trim()).not.toBe('');
      expect(voice.lang).toBe('zh-CN');
      expect(['male', 'female']).toContain(voice.gender);
    }
  });

  it('uses unique voice ids', () => {
    const ids = DOUBAO_VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the list through the provider with descriptions intact', async () => {
    const voices = await new DoubaoSpeechProvider(() => null).getAllVoices();
    expect(voices).toHaveLength(DOUBAO_VOICES.length);
    expect(voices[0]).toMatchObject({
      id: DOUBAO_VOICES[0]!.id,
      name: DOUBAO_VOICES[0]!.name,
      description: DOUBAO_VOICES[0]!.description,
      lang: 'zh-CN',
    });
  });
});
