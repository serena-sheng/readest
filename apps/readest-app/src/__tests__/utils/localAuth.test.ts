import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const supabaseAuth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  refreshSession: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/supabase', () => ({ supabase: { auth: supabaseAuth } }));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LOCAL_USER, isLocalAuthEnabled } from '@/utils/localAuth';
import { LOCAL_UNLOCK } from '@/utils/localUnlock';

afterEach(cleanup);

describe('LOCAL_USER', () => {
  test('is the minimal Supabase-user shape cloud-aware code reads', () => {
    expect(LOCAL_USER.id).toBe('local-device');
    expect(LOCAL_USER.email).toBe('local@device');
    expect(LOCAL_USER.aud).toBe('authenticated');
    expect(LOCAL_USER.role).toBe('authenticated');
    expect(LOCAL_USER.app_metadata).toEqual({ provider: 'local', providers: ['local'] });
    expect(LOCAL_USER.user_metadata).toBeTypeOf('object');
    expect(LOCAL_USER.created_at).toBeTypeOf('string');
  });
});

describe('isLocalAuthEnabled', () => {
  test('follows the LOCAL_UNLOCK build constant', () => {
    expect(isLocalAuthEnabled()).toBe(LOCAL_UNLOCK);
  });
});

describe('AuthProvider in the local build', () => {
  test('reports the local user as signed in without contacting Supabase', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    expect(result.current.user).toEqual(LOCAL_USER);
    expect(result.current.token).toBeNull();

    // No session exists, so the guard that would send the reader to /auth can
    // never fire: every `if (!user)` branch now sees a signed-in device user.
    expect(supabaseAuth.onAuthStateChange).not.toHaveBeenCalled();
    expect(supabaseAuth.refreshSession).not.toHaveBeenCalled();
  });

  test('keeps the local user when logout is requested', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    result.current.logout();

    expect(result.current.user).toEqual(LOCAL_USER);
    expect(supabaseAuth.signOut).not.toHaveBeenCalled();
  });
});
