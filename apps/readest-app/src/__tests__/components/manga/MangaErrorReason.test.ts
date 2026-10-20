import { describe, expect, it, vi } from 'vitest';

import { mangaErrorReason } from '@/app/reader/hooks/useMangaTranslation';

// The hook module imports the theme store, whose module init reads
// localStorage. This suite only exercises the pure error mapping.
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));

describe('mangaErrorReason', () => {
  it('names the translation service it cannot reach', () => {
    expect(
      mangaErrorReason(new Error('fetch failed'), { baseUrl: 'https://api.example.com/v1' }),
    ).toBe('连不上翻译服务（https://api.example.com/v1）');
  });

  it('still names the failure when no address is known', () => {
    expect(mangaErrorReason(new Error('网络不可用'))).toBe('连不上翻译服务');
  });

  it('keeps the API key and rate-limit wording', () => {
    expect(mangaErrorReason(new Error('HTTP 401'))).toBe(
      '模型拒绝了 API Key，去设置里换一个新的。',
    );
    expect(mangaErrorReason(new Error('HTTP 429'))).toBe('请求太频繁，等一下再试。');
  });
});
