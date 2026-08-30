import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MagicVerify } from '@/features/auth/magic/magic-verify';
import { Spinner } from '@/components/spinner';

export const metadata: Metadata = {
  title: 'Signing in…',
};

export default function MagicLinkPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MagicVerify />
    </Suspense>
  );
}
