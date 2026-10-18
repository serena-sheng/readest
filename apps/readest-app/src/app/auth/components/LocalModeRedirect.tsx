'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Local build (`utils/localUnlock.ts`): every `/auth/**` route is dead. Render
 * this instead of the sign-in UI so a stale bookmark or deep link lands on the
 * library. Only render it while {@link isLocalAuthEnabled} is true — it always
 * redirects.
 */
export default function LocalModeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library');
  }, [router]);

  return null;
}
