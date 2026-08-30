'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { AUTH_PATHS } from '@/lib/constant/paths';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const signOut = async () => {
    setIsLoading(true);
    try {
      await authClient.signOut();
      router.push(AUTH_PATHS.SIGNIN);
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
      data-umami-event="backoffice-sign-out"
    >
      {isLoading ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
