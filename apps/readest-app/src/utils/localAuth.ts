/**
 * Local self-hosted build: the device is its own account.
 *
 * `LOCAL_UNLOCK` turns every cloud-backed sign-in into dead weight — there is
 * no server to authenticate against and all data lives on this machine (plus
 * iCloud). In that build {@link AuthContext} reports {@link LOCAL_USER} instead
 * of a Supabase session, and every route that used to ask for credentials
 * becomes a no-op or bounces to `/library`.
 *
 * Upstream builds keep `LOCAL_UNLOCK` false, so none of this changes their
 * behaviour.
 */
import type { User } from '@supabase/supabase-js';
import { LOCAL_UNLOCK } from '@/utils/localUnlock';

/**
 * Stand-in for a Supabase user. It only has to satisfy code that reads
 * `user.id` / `user.email` to decide whether cloud features are available; it
 * carries no token, so nothing can authenticate with it.
 */
export const LOCAL_USER: User = {
  id: 'local-device',
  email: 'local@device',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'local', providers: ['local'] },
  user_metadata: { full_name: 'Local Reader' },
  created_at: '1970-01-01T00:00:00.000Z',
};

/** True when this build replaces Supabase auth with {@link LOCAL_USER}. */
export const isLocalAuthEnabled = () => LOCAL_UNLOCK;
