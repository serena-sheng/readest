// The Doubao voices offered for audiobook listening. BigTTS (`_bigtts`) voices
// are the long-form ones; this is a deliberately short, hand-picked list so
// the picker stays a decision rather than a catalog dump.

export type DoubaoVoice = {
  id: string;
  name: string;
  description: string;
  lang: 'zh-CN';
  gender: 'male' | 'female';
};

export const DOUBAO_VOICES: DoubaoVoice[] = [
  {
    id: 'zh_female_vv_jupiter_bigtts',
    name: 'Vv',
    description: '女声，语速平稳，长段落不累',
    lang: 'zh-CN',
    gender: 'female',
  },
  {
    id: 'zh_female_shuangkuaisisi_moon_bigtts',
    name: '爽快思思',
    description: '女声，明快清晰，适合节奏紧的书',
    lang: 'zh-CN',
    gender: 'female',
  },
  {
    id: 'zh_female_wanwanxiaohe_moon_bigtts',
    name: '湾湾小何',
    description: '女声，柔和，适合散文与小说',
    lang: 'zh-CN',
    gender: 'female',
  },
  {
    id: 'zh_male_yangguangqingnian_moon_bigtts',
    name: '阳光青年',
    description: '男声，中性耐听',
    lang: 'zh-CN',
    gender: 'male',
  },
  {
    id: 'zh_male_ahu_conversation_wvae_bigtts',
    name: '阿虎',
    description: '男声，口语化，对白多的书更自然',
    lang: 'zh-CN',
    gender: 'male',
  },
  {
    id: 'zh_male_wennuanahu_moon_bigtts',
    name: '温暖阿虎',
    description: '男声，低沉，适合夜里听',
    lang: 'zh-CN',
    gender: 'male',
  },
];
