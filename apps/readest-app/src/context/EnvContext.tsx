'use client';

import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { EnvConfigType } from '../services/environment';
import { AppService } from '@/types/system';
import env from '../services/environment';
import { bootstrapReplicaAdapters } from '@/services/sync/replicaBootstrap';
import { initReplicaSync } from '@/services/sync/replicaSync';
import { createSettingsCursorStore } from '@/services/sync/replicaCursorStore';
import { startReplicaTransferIntegration } from '@/services/sync/replicaTransferIntegration';
import { enableReplicaAutoPersist } from '@/services/sync/replicaPersist';
import { isIcloudLibraryEnabled, setupIcloudLibrary } from '@/services/icloud/icloudStartup';

interface EnvContextType {
  envConfig: EnvConfigType;
  appService: AppService | null;
}

const EnvContext = createContext<EnvContextType | undefined>(undefined);

export const EnvProvider = ({ children }: { children: ReactNode }) => {
  const [envConfig] = useState<EnvConfigType>(env);
  const [appService, setAppService] = useState<AppService | null>(null);

  React.useEffect(() => {
    bootstrapReplicaAdapters();
    enableReplicaAutoPersist(envConfig);
    envConfig
      .getAppService()
      .then(async (service) => {
        try {
          const settings = await service.loadSettings();
          if (isIcloudLibraryEnabled(settings)) {
            // Must run before the library is read: on first use it moves the
            // books into iCloud Drive and links `Books/` at them.
            const icloud = await setupIcloudLibrary(service);
            if (icloud && icloud.migration.failed.length > 0) {
              console.warn('[iCloud] library setup failed:', icloud.migration.error);
            }
          }
          if (settings.replicaDeviceId) {
            const ctx = initReplicaSync({
              deviceId: settings.replicaDeviceId,
              cursorStore: createSettingsCursorStore(service),
            });
            ctx.manager.startAutoSync();
            startReplicaTransferIntegration(service);
          }
        } catch (err) {
          console.warn('App service post-init setup failed', err);
        }
        setAppService(service);
      })
      // Every page gates its render on a non-null `appService`, so an
      // unhandled rejection here is invisible: no error, no UI, just a blank
      // window for the rest of the session. Surface it instead.
      .catch((err) => {
        console.error('Failed to initialize app service:', err);
      });
    // Swallow the benign resize notice so it never reaches an error reporter.
    // Chromium renamed it — it was "ResizeObserver loop limit exceeded" and is
    // now "ResizeObserver loop completed with undelivered notifications." — so
    // the old exact match silently stopped catching anything. Both wordings
    // mean the same thing: observations were deferred to the next frame.
    window.addEventListener('error', (e) => {
      if (e.message?.startsWith('ResizeObserver loop')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
      }
      return false;
    });
  }, [envConfig]);

  const value = useMemo(() => ({ envConfig, appService }), [envConfig, appService]);
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
};

export const useEnv = (): EnvContextType => {
  const context = useContext(EnvContext);
  if (!context) throw new Error('useEnv must be used within EnvProvider');
  return context;
};
