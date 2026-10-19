import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ViewSettings } from '@/types/book';

const state = vi.hoisted(() => ({
  viewSettings: {
    ttsMediaMetadata: 'sentence',
    ttsPlayerStyle: 'full',
    ttsHighlightGranularity: 'word',
    ttsHighlightOptions: { style: 'highlight', color: '#808080' },
    ttsSkipInlineAnnotations: false,
    ttsVoice: '',
  } as unknown as ViewSettings,
  setSettings: vi.fn(),
  saveSettings: vi.fn(),
  settings: {
    globalViewSettings: {} as ViewSettings,
    globalReadSettings: { customTtsHighlightColors: [] },
    ttsDoubaoAppId: '',
    ttsDoubaoAccessToken: '',
    ttsDoubaoCluster: 'volcano_tts',
  },
}));

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => state.viewSettings }),
}));

vi.mock('@/store/settingsStore', () => {
  const store = {
    settings: state.settings,
    setSettings: state.setSettings,
    saveSettings: state.saveSettings,
  };
  return { useSettingsStore: Object.assign(() => store, { getState: () => store }) };
});

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  getTTSCacheConfig: () => ({ enabled: false, syncEnabled: false, budgetMB: 200 }),
  setTTSCacheConfig: vi.fn(),
}));

vi.mock('@/services/tts/voiceCatalog', () => ({
  loadLocalVoiceGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

import TTSPanel from '@/components/settings/TTSPanel';

const renderPanel = () => render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

describe('TTSPanel Doubao settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.settings.globalViewSettings = state.viewSettings;
    state.settings.ttsDoubaoAppId = '';
    state.settings.ttsDoubaoAccessToken = '';
    state.settings.ttsDoubaoCluster = 'volcano_tts';
    state.saveSettings.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('shows the configuration hint until both credentials are filled in', () => {
    renderPanel();

    expect(
      screen.getByText('填入火山引擎语音合成的 App ID 与 Access Token 后可用'),
    ).toBeTruthy();
    expect(screen.getByText('豆包语音')).toBeTruthy();
  });

  it('saves the credentials into the global settings', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: '  app-123  ' } });
    fireEvent.change(screen.getByLabelText('Access Token'), { target: { value: 'tok-456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Doubao Settings' }));

    expect(state.setSettings).toHaveBeenCalledTimes(1);
    expect(state.saveSettings).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        ttsDoubaoAppId: 'app-123',
        ttsDoubaoAccessToken: 'tok-456',
        ttsDoubaoCluster: 'volcano_tts',
      }),
    );
    expect(screen.queryByText('填入火山引擎语音合成的 App ID 与 Access Token 后可用')).toBeNull();
  });

  it('masks the access token by default and toggles its visibility', () => {
    renderPanel();

    const token = screen.getByLabelText('Access Token') as HTMLInputElement;
    expect(token.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show Access Token' }));
    expect((screen.getByLabelText('Access Token') as HTMLInputElement).type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide Access Token' }));
    expect((screen.getByLabelText('Access Token') as HTMLInputElement).type).toBe('password');
  });
});
