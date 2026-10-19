import { getLanguageName } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import type { TranslationFunc } from '@/hooks/useTranslation';
import type { TTSVoice, TTSVoicesGroup } from './types';

const SYSTEM_GROUP_IDS: Record<string, true> = {
  'web-speech-api': true,
  native: true,
  default: true,
};

// Language names come from the voice's own lang tag, rendered in the UI
// language when the runtime supports it (中文, not "Chinese" on a zh UI).
export const getVoiceLanguageName = (lang: string): string => {
  if (!lang || lang === 'mul') return '';
  const code = lang.split('-')[0]!;
  try {
    const localized = new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code);
    if (localized) return localized;
  } catch {}
  return getLanguageName(lang);
};

export const getVoiceEngineName = (_: TranslationFunc, group: TTSVoicesGroup): string => {
  if (group.id === 'edge-tts') return _('Edge');
  if (group.id === 'doubao-tts') return _('豆包');
  if (SYSTEM_GROUP_IDS[group.id] === true) return _('System');
  return _(group.name);
};

// The one-line description under the voice name: language · gender · engine.
// Gender is only shown when the engine supplied it. A voice with its own
// description replaces gender with that note (the note already names gender),
// keeping the row to one readable line.
export const getVoiceMetaLine = (
  _: TranslationFunc,
  group: TTSVoicesGroup,
  voice: TTSVoice,
): string => {
  const gender = voice.gender === 'male' ? _('Male') : voice.gender === 'female' ? _('Female') : '';
  return [
    getVoiceLanguageName(voice.lang),
    voice.description ? undefined : gender,
    getVoiceEngineName(_, group),
    voice.description,
  ]
    .filter(Boolean)
    .join(' · ');
};

const CHINESE_PREVIEW_TEXT = '你好，这是这个音色的试听示例。';
const DEFAULT_PREVIEW_TEXT = 'Hello, this is a preview of this voice.';

// Chinese voices read Chinese; every other voice reads English, as specified
// for the sample sentence.
export const getVoicePreviewText = (lang: string): string =>
  /^zh/i.test(lang) ? CHINESE_PREVIEW_TEXT : DEFAULT_PREVIEW_TEXT;
