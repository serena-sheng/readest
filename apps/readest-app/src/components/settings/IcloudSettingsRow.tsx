import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { ensureIcloudLibrary } from '@/services/icloud/icloudLibrary';
import { isIcloudLibraryEnabled, setupIcloudLibrary } from '@/services/icloud/icloudStartup';
import { BoxedList, SettingsRow, SettingsSwitchRow } from './primitives';

const primaryButtonClass = clsx(
  'btn btn-contrast',
  'h-9 min-h-9 rounded-lg border-0 px-4 text-sm font-medium',
  'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
);

/**
 * Settings row for the iCloud-backed library: books live in
 * `<iCloud Drive>/Readest/Books`, and the app's own `Books/` path is a
 * symbolic link to it. The action button verifies that link (and repairs it,
 * migrating anything still local) rather than copying files around.
 *
 * macOS-only; callers gate on `appService.isMacOSApp`.
 */
const IcloudSettingsRow: React.FC = () => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const enabled = isIcloudLibraryEnabled(settings);
  const [libraryPath, setLibraryPath] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!appService) return;
    void ensureIcloudLibrary(appService).then((paths) => {
      if (!cancelled && paths) setLibraryPath(paths.books);
    });
    return () => {
      cancelled = true;
    };
  }, [appService]);

  const checkOrRepairLink = async () => {
    if (!appService || busy) return;
    setBusy(true);
    try {
      const result = await setupIcloudLibrary(appService);
      if (!result) {
        eventDispatcher.dispatch('toast', {
          message: _('iCloud Drive is unavailable. Your library stays on this device.'),
          timeout: 4000,
          type: 'error',
        });
        return;
      }
      setLibraryPath(result.paths.books);
      const { failed, moved, merged } = result.migration;
      if (failed.length > 0 || !result.migration.linked) {
        eventDispatcher.dispatch('toast', {
          message: result.migration.error
            ? _('Could not set up the iCloud library: {{error}}', {
                error: result.migration.error,
              })
            : _('Could not set up the iCloud library.'),
          timeout: 5000,
          type: 'error',
        });
        return;
      }
      eventDispatcher.dispatch('toast', {
        message:
          moved + merged > 0
            ? _('Moved {{count}} item(s) to iCloud Drive', { count: moved + merged })
            : _('iCloud library is up to date'),
        timeout: 2500,
        type: 'success',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    const next = !enabled;
    await saveSysSettings(envConfig, 'icloudMirrorEnabled', next);
    if (next) void checkOrRepairLink();
  };

  return (
    <BoxedList title={_('Library Storage')} data-setting-id='settings.integrations.icloudLibrary'>
      <SettingsSwitchRow
        label={_('Store Library in iCloud')}
        description={_(
          'Books are kept in iCloud Drive and shared with your other devices. Your library folder becomes a shortcut to iCloud instead of a second copy.',
        )}
        checked={enabled}
        onChange={() => void handleToggle()}
      />
      <SettingsRow label={_('iCloud Location')} description={libraryPath || _('Not available')}>
        <button
          className={primaryButtonClass}
          onClick={() => void checkOrRepairLink()}
          disabled={busy || !appService}
        >
          {busy ? <span className='loading loading-spinner loading-xs' /> : null}
          {_('Check / Repair Link')}
        </button>
      </SettingsRow>
    </BoxedList>
  );
};

export default IcloudSettingsRow;
