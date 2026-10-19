import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'en-US',
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => state.viewSettings }),
}));

vi.mock('@/store/settingsStore', () => {
  const store = {
    settings: {
      globalViewSettings: state.viewSettings,
      globalReadSettings: { customTtsHighlightColors: [] },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
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

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

// The settings picker loads system + Edge voices directly. The fixture keeps a
// Readest Voice group (authRequired) to prove the panel filters it out; the
// catalog itself performs the same filter in production.
vi.mock('@/services/tts/voiceCatalog', () => ({
  loadLocalVoiceGroups: vi.fn().mockResolvedValue([
    {
      id: 'readest-tts',
      name: 'Readest Voice',
      authRequired: true,
      voices: [{ id: 'kokoro:zf_001', name: 'Readest Narrator', lang: 'en-US' }],
    },
    {
      id: 'web-speech-api',
      name: 'Web TTS',
      voices: [
        { id: 'ava', name: 'Ava', lang: 'en-US', gender: 'female' },
        { id: 'ting-ting', name: 'Ting-Ting', lang: 'zh-CN' },
      ],
    },
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      voices: [{ id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US', gender: 'male' }],
    },
  ]),
}));

const speak = vi.fn();
const cancel = vi.fn();

class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

const installSpeechSynthesis = () => {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak,
      cancel,
      getVoices: () => [
        { voiceURI: 'ava', name: 'Ava', lang: 'en-US' },
        { voiceURI: 'ting-ting', name: 'Ting-Ting', lang: 'zh-CN' },
      ],
    },
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeUtterance,
  });
};

import { saveViewSettings } from '@/helpers/settings';
import TTSPanel from '@/components/settings/TTSPanel';

const voiceRow = (name: string) => {
  const row = screen.getByText(name).closest('button')!.parentElement!;
  return within(row);
};

describe('TTSPanel local voice filtering and preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewSettings.ttsVoice = '';
    installSpeechSynthesis();
  });

  afterEach(cleanup);

  it('hides the account-gated Readest Voice group and its voices', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(await screen.findByText('Ava')).toBeTruthy();
    expect(screen.queryByText('Readest Voice')).toBeNull();
    expect(screen.queryByText('Readest Narrator')).toBeNull();
  });

  it('renders a system voice with language, gender, and engine', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(await screen.findByText('Ava')).toBeTruthy();
    expect(screen.getByText('English · Female · System')).toBeTruthy();
    expect(screen.getByText('English · Male · Edge')).toBeTruthy();
  });

  it('previews a voice and turns the button into Stop', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    await screen.findByText('Ava');
    fireEvent.click(voiceRow('Ava').getByLabelText('Preview'));

    expect(speak).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0]![0] as FakeUtterance;
    expect(utterance.text).toBe('Hello, this is a preview of this voice.');
    expect(screen.getByLabelText('Stop Preview')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('stops the sounding preview from the same button', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    await screen.findByText('Ava');
    fireEvent.click(voiceRow('Ava').getByLabelText('Preview'));
    const cancelsAfterStart = cancel.mock.calls.length;

    fireEvent.click(voiceRow('Ava').getByLabelText('Stop Preview'));

    expect(cancel.mock.calls.length).toBeGreaterThan(cancelsAfterStart);
    expect(voiceRow('Ava').getByLabelText('Preview')).toBeTruthy();
  });

  it('reads the Chinese sample for a Chinese voice', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(await screen.findByText('Ting-Ting')).toBeTruthy();
    fireEvent.click(voiceRow('Ting-Ting').getByLabelText('Preview'));

    const utterance = speak.mock.calls[0]![0] as FakeUtterance;
    expect(utterance.text).toBe('你好，这是这个音色的试听示例。');
  });

  it('persists a selection to the existing ttsVoice view setting', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    fireEvent.click(await screen.findByText('Ava'));

    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book-1', 'ttsVoice', 'ava', false, false),
    );
  });
});
