'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { PATHS } from '@/lib/constant/paths';
import { Button } from '@/components/ui/button';

/**
 * `page` names where this is mounted, for the analytics event.
 *
 * It used to live only in the admin panel and could hardcode its own name.
 * It is now on the account page too, and AGENTS.md spells the convention
 * `<page>-<element>-<action>` — one hardcoded name would file every admin
 * sign-out under the storefront and make the two indistinguishable.
 */
export function SignOutButton({ page }: { page: 'account' | 'admin-panel' }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const signOut = async () => {
    setIsLoading(true);
    try {
      await authClient.signOut();
      router.push(PATHS.HOME);
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={signOut}
      disabled={isLoading}
      data-umami-event={`${page}-sign-out`}
    >
      {isLoading ? 'در حال خروج…' : 'خروج از حساب'}
    </Button>
  );
}
