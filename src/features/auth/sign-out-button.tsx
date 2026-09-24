'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { PATHS } from '@/lib/constant/paths';

/** `page` names where this is mounted, for the `<page>-sign-out` event. */
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
    // brand terracotta, and white on it fails AA.
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
