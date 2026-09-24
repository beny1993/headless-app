'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { PATHS } from '@/lib/constant/paths';

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
    // Hover is `secondary`, not shadcn's stock `accent`: here --accent is the
    // brand terracotta, and white on it fails AA (design review, finding 24).
    <button
      className="bg-background hover:bg-secondary hover:text-secondary-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
      onClick={signOut}
      disabled={isLoading}
      data-umami-event={`${page}-sign-out`}
    >
      {isLoading ? 'در حال خروج…' : 'خروج از حساب'}
    </button>
  );
}
