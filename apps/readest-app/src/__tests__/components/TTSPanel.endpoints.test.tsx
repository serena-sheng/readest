import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ViewSettings } from '@/types/book';
import {
  getActiveEndpointId,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TTSEndpoint,
} from '@/services/tts/customEndpoints';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => fetchMock,
}));

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

vi.mock('@/services/tts/voiceCatalog', () => ({
  loadLocalVoiceGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

import TTSPanel from '@/components/settings/TTSPanel';

// Node 26 exposes an unavailable global `localStorage`, so stub a real
// in-memory Storage instead of relying on jsdom's.
const createStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
};

const endpoint = (overrides: Partial<TTSEndpoint> = {}): TTSEndpoint => ({
  id: 'local',
  name: 'Local Kokoro',
  baseUrl: 'http://127.0.0.1:8880/v1',
  model: 'kokoro',
  voice: 'af_heart',
  enabled: true,
  ...overrides,
});

const renderPanel = () => render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

describe('TTSPanel custom endpoints', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the empty state and the add button', () => {
    renderPanel();

    expect(screen.getByText('No custom endpoints yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Endpoint' })).toBeTruthy();
  });

  it('adds an endpoint inline and makes it active', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Add Endpoint' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kokoro' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://127.0.0.1:8880/v1' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'kokoro' } });
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'af_heart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Kokoro · 127.0.0.1:8880')).toBeTruthy();
    expect(screen.getByText('In Use')).toBeTruthy();

    const saved = listEndpoints();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Kokoro',
      baseUrl: 'http://127.0.0.1:8880/v1',
      model: 'kokoro',
      voice: 'af_heart',
      enabled: true,
    });
    expect(getActiveEndpointId()).toBe(saved[0]!.id);
  });

  it('switches the active endpoint from its row', () => {
    saveEndpoint(endpoint({ id: 'a', name: 'Home', baseUrl: 'http://127.0.0.1:8880/v1' }));
    saveEndpoint(endpoint({ id: 'b', name: 'Cloud', baseUrl: 'https://tts.example.com/v1' }));
    setActiveEndpointId('a');
    renderPanel();

    const row = screen.getByTestId('tts-endpoint-b');
    fireEvent.click(within(row).getByRole('button', { name: 'Enable' }));

    expect(getActiveEndpointId()).toBe('b');
    expect(within(row).getByText('In Use')).toBeTruthy();
    expect(
      within(screen.getByTestId('tts-endpoint-a')).getByRole('button', { name: 'Enable' }),
    ).toBeTruthy();
  });

  it('deletes an endpoint and returns to the empty state', () => {
    saveEndpoint(endpoint({ id: 'local', name: 'Home' }));
    renderPanel();

    const row = screen.getByTestId('tts-endpoint-local');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Home' }));

    expect(screen.queryByTestId('tts-endpoint-local')).toBeNull();
    expect(listEndpoints()).toEqual([]);
    expect(screen.getByText('No custom endpoints yet')).toBeTruthy();
  });

  it('tests the edited endpoint with the OpenAI-compatible request shape', async () => {
    saveEndpoint(endpoint({ id: 'local', name: 'Home', apiKey: 'secret' }));
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      text: async () => '',
    });
    renderPanel();

    const row = screen.getByTestId('tts-endpoint-local');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8880/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({
      model: 'kokoro',
      input: 'Hello.',
      voice: 'af_heart',
      response_format: 'mp3',
    });
    const status = await screen.findByRole('status');
    // vitest here has no jest-dom matchers; assert on textContent directly.
    expect(status.textContent ?? '').toMatch(/^Available · \d+ms$/);
  });
});
