import { useSettingsStore } from '@/store/settingsStore';
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { CachingProvider, type TTSCacheStore } from './providers/cache';
import { DoubaoSpeechProvider, readDoubaoConfig } from './providers/doubao';
// Type-only: TTSController imports this client, so a value import here would
// create a module cycle.
import type { TTSController } from './TTSController';

// Whether the reader filled in both credentials. The controller checks this
// before constructing a client, so an unconfigured local build never lists
// (or instantiates) the engine.
export const isDoubaoConfigured = (): boolean =>
  readDoubaoConfig(useSettingsStore.getState().settings) !== null;

// Everything engine-independent (scheduler, playout, word tracking, preload)
// lives in BufferedTTSClient; the Volcano request lives in DoubaoSpeechProvider.
// This subclass only names the persisted client and wires the shared per-book
// audio cache, mirroring EdgeTTSClient.
export class DoubaoSpeechClient extends BufferedTTSClient {
  constructor(
    controller?: TTSController,
    appService?: AppService | null,
    store?: TTSCacheStore | null,
  ) {
    const provider = new DoubaoSpeechProvider(() =>
      readDoubaoConfig(useSettingsStore.getState().settings),
    );
    // Unlike Edge, the cache store is supplied by the controller (it already
    // built one for the other synthetic engines); a standalone client simply
    // has no persistent cache.
    super(store ? new CachingProvider(provider, store) : provider, controller, appService);
  }
}
