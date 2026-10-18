/**
 * Local self-hosted build switch: unlock every premium feature without a
 * server-issued entitlement.
 *
 * This is a build-time constant, not a setting. It only ever appears in this
 * local fork; upstream builds keep it `false` so the paywall logic in
 * `utils/access.ts` stays byte-for-byte behaviourally identical.
 */
export const LOCAL_UNLOCK = true;

/**
 * Plan reported while {@link LOCAL_UNLOCK} is on. `purchase` is the lifetime
 * plan, which every client-side feature list already treats as paid.
 */
export const LOCAL_PLAN = 'purchase' as const;
