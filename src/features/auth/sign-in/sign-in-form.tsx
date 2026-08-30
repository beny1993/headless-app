'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_SITE_NAME } from '@/constants';
import { authClient } from '@/lib/auth/client';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Step = 'email' | 'otp';

export function SignInForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const requestOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const response = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      });
      if (response.error?.message) {
        setError(response.error.message);
      } else {
        setStep('otp');
      }
    } catch {
      setError('We cannot connect to the server right now, please try again');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const response = await authClient.signIn.emailOtp({ email, otp });
      if (response.error?.message) {
        setError(response.error.message);
      } else {
        router.push(PROTECTED_PATHS.INDEX);
      }
    } catch {
      setError('We cannot connect to the server right now, please try again');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{DEFAULT_SITE_NAME} admin panel</CardTitle>
        <CardDescription>
          {step === 'email'
            ? 'Enter your email to receive a one-time sign-in code.'
            : `We sent a code to ${email}. In development it's printed in the server console.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 'email' ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              data-umami-event="signin-request-otp"
            >
              {isLoading ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="otp">One-time code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              data-umami-event="signin-verify-otp"
            >
              {isLoading ? 'Verifying…' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep('email');
                setOtp('');
                setError('');
              }}
              data-umami-event="signin-change-email"
            >
              Use a different email
            </Button>
          </form>
        )}
        {error ? (
          <p className="text-destructive mt-4 text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
