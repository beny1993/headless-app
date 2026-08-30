import type { Metadata } from 'next';
import { SignInForm } from '@/features/auth/sign-in/sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function SignInPage() {
  return <SignInForm />;
}
