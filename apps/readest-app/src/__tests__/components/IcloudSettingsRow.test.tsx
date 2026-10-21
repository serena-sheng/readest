import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

const state = vi.hoisted(() => ({
  settings: { icloudMirrorEnabled: true } as Partial<SystemSettings>,
}));

const appService = vi.hoisted(
  () =>
    ({
      isMacOSApp: true,
    }) as unknown as AppService,
);

const setupIcloudLibrary = vi.hoisted(() => vi.fn());
const ensureIcloudLibrary = vi.hoisted(() => vi.fn());
const saveSysSettings = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService,
    envConfig: { getAppService: async () => appService },
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: state.settings }),
}));

vi.mock('@/helpers/settings', () => ({ saveSysSettings }));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch },
}));

vi.mock('@/services/icloud/icloudLibrary', () => ({ ensureIcloudLibrary }));

vi.mock('@/services/icloud/icloudStartup', () => ({
  isIcloudLibraryEnabled: (settings: Partial<SystemSettings> | null | undefined) =>
    settings?.icloudMirrorEnabled !== false,
  setupIcloudLibrary,
}));

import IcloudSettingsRow from '@/components/settings/IcloudSettingsRow';

describe('IcloudSettingsRow', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    state.settings = { icloudMirrorEnabled: true };
    setupIcloudLibrary.mockReset();
    ensureIcloudLibrary.mockReset();
    saveSysSettings.mockReset();
    dispatch.mockReset();
    ensureIcloudLibrary.mockResolvedValue({
      root: '/icloud/Readest',
      books: '/icloud/Readest/Books',
      manifest: '/icloud/Readest/library.json',
    });
  });

  it('renders the switch as enabled and shows the iCloud location', async () => {
    render(<IcloudSettingsRow />);

    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await waitFor(() => expect(screen.getByText('/icloud/Readest/Books')).toBeTruthy());
  });

  it('writes the setting when the switch is toggled', async () => {
    render(<IcloudSettingsRow />);
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(saveSysSettings).toHaveBeenCalledWith(expect.anything(), 'icloudMirrorEnabled', false),
    );
  });

  it('checks and repairs the link when the button is pressed', async () => {
    setupIcloudLibrary.mockResolvedValue({
      paths: { root: '/icloud/Readest', books: '/icloud/Readest/Books', manifest: '' },
      migration: { moved: 2, merged: 0, failed: [], linked: true },
    });
    render(<IcloudSettingsRow />);

    fireEvent.click(screen.getByRole('button', { name: /Check \/ Repair Link/ }));

    await waitFor(() => expect(setupIcloudLibrary).toHaveBeenCalledWith(appService));
    expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'success' }));
  });

  it('reports an error when iCloud Drive is unavailable', async () => {
    setupIcloudLibrary.mockResolvedValue(null);
    render(<IcloudSettingsRow />);

    fireEvent.click(screen.getByRole('button', { name: /Check \/ Repair Link/ }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' })),
    );
  });
});
