'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { Spinner } from '@/components/spinner';

export function MagicVerify() {
  const router = useRouter();
  const params = useSearchParams();

  const email = params.get('email');
  const otp = params.get('otp');
  // Derived, not set in the effect — missing params never start a verification.
  const hasParams = Boolean(email && otp);

  const [isVerifying, setIsVerifying] = useState(hasParams);
  const [verifyError, setVerifyError] = useState('');

  useEffect(() => {
    if (!email || !otp) return;

    authClient.signIn
      .emailOtp({ email, otp })
      .then((response) => {
        setIsVerifying(false);
        if (response.error?.message) {
          setVerifyError(response.error.message ?? 'OTP is not valid');
        } else {
          router.push(PROTECTED_PATHS.INDEX);
        }
      })
      .catch(() => {
        setIsVerifying(false);
        setVerifyError(
          'We cannot connect to the server right now, please try again',
        );
      });
  }, [email, otp, router]);

  const error = hasParams ? verifyError : 'OTP or email has not been set';

  return (
    <div className="flex flex-col items-center gap-4">
      {isVerifying ? <Spinner /> : null}
      {error ? (
        <div className="bg-destructive/10 text-destructive rounded-lg px-8 py-4 text-sm">
          {error}
        </div>
      ) : null}
    </div>
  );
}
