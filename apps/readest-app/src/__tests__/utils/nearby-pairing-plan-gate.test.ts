// Local unlock build (`utils/localUnlock.ts`): Nearby BookDrop pairing is open
// for every plan, so these upstream gate assertions no longer apply. Skipped,
// not deleted, so the file stays easy to reconcile with upstream.
import { describe, expect, test } from 'vitest';

import {
  NEARBY_PAIRING_REQUIRES_PREMIUM,
  isNearbyPairingAllowed,
  isNearbyPairingInPlan,
} from '@/utils/access';

describe.skip('isNearbyPairingInPlan', () => {
  test('any paid plan can pair Nearby BookDrop devices', () => {
    expect(isNearbyPairingInPlan('plus', false)).toBe(true);
    expect(isNearbyPairingInPlan('pro', false)).toBe(true);
    // A storage-only buyer reports `purchase` without being entitled.
    expect(isNearbyPairingInPlan('purchase', false)).toBe(false);
  });

  test('free plan cannot', () => {
    expect(isNearbyPairingInPlan('free', false)).toBe(false);
  });
});

describe.skip('isNearbyPairingAllowed (premium paywall)', () => {
  test('pairing for confirmation-free drops requires a paid plan', () => {
    expect(NEARBY_PAIRING_REQUIRES_PREMIUM).toBe(true);
    expect(isNearbyPairingAllowed('free', false)).toBe(false);
    expect(isNearbyPairingAllowed('plus', false)).toBe(true);
    expect(isNearbyPairingAllowed('pro', false)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', false)).toBe(false);
  });

  test('the Full Customization unlock entitles a free user', () => {
    expect(isNearbyPairingAllowed('free', true)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', true)).toBe(true);
  });
});
