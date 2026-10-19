import { LOCAL_UNLOCK } from '@/utils/localUnlock';
import type { TTSVoicesGroup } from './types';

// Engines that authenticate against the Readest account service. A local
// build has no token, so listing their voices only leads the reader into a
// picker whose playback can never start.
const AUTH_REQUIRED_GROUP_IDS: Record<string, true> = { 'readest-tts': true };

export const isAuthRequiredVoiceGroup = (group: TTSVoicesGroup): boolean =>
  group.authRequired === true ||
  AUTH_REQUIRED_GROUP_IDS[group.id] === true ||
  group.name === 'Readest Voice';

// Every voice/engine list runs through this: in a LOCAL_UNLOCK build the
// account-gated engines are removed; upstream builds keep the list unchanged.
export const filterVoiceGroups = (groups: TTSVoicesGroup[]): TTSVoicesGroup[] =>
  LOCAL_UNLOCK ? groups.filter((group) => !isAuthRequiredVoiceGroup(group)) : groups;
