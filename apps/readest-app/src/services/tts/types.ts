export type TTSGranularity = 'sentence' | 'word';

export type TTSHighlightGranularity = 'word' | 'sentence';

export type TTSMediaMetadataMode = 'sentence' | 'paragraph' | 'chapter';

// Mini player card style: 'full' is the pre-#5162 (0.11.18) card with book
// cover, book title, chapter + timestamps; 'minimal' is the chrome-free card.
export type TTSPlayerStyle = 'full' | 'minimal';

export type TTSHighlightOptions = {
  style: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';
  color: string;
};

// The language of a voice that reads any language (ISO 639 "multiple
// languages"). Its preference is kept under this code, not the book's.
export const MULTILINGUAL_LANG = 'mul';

export type TTSVoice = {
  id: string;
  name: string;
  lang: string;
  // Present only when the engine reports it; most system and Edge voices do
  // not, so the picker omits the field instead of guessing from the name.
  gender?: 'male' | 'female';
  disabled?: boolean;
  // A one-line engine-authored note ("女声，语速平稳…"), shown in the picker's
  // meta line in place of the generic language/gender/engine summary.
  description?: string;
  // Premium voices: the plan that unlocks them, shown as a badge.
  tier?: 'plus' | 'pro';
  // A trait the engine spells into the voice id, shown as a badge instead of
  // in the name.
  variant?: 'multilingual' | 'expressive';
};

export type TTSVoicesGroup = {
  id: string;
  name: string;
  voices: TTSVoice[];
  disabled?: boolean;
  // The engine needs an account token: a local build (LOCAL_UNLOCK) cannot
  // use it and hides the group from every picker.
  authRequired?: boolean;
};

export type TTSMark = {
  offset: number;
  name: string;
  text: string;
  language: string;
};
