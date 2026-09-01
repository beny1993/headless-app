import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login/login-form';
import { nextPathSchema } from '@/lib/auth/next-path';

export const metadata: Metadata = { title: 'ورود به اسموکی' };

/**
 * The site's only sign-in. Customers and admins use the same one — an admin is
 * a customer row with `role: 'admin'`, granted by `pnpm create-admin`.
 *
 * `?next=` is where to return to afterwards, and it is a stranger's input: it
 * crosses `nextPathSchema`, which degrades anything off-site to the home page
 * rather than rejecting it (page inputs degrade, APIs reject — AGENTS.md).
 * Without that check this page is an open redirect on a real domain, which is
 * the most useful thing a phishing link can borrow.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = nextPathSchema.parse((await searchParams).next);

  return <LoginForm next={next} />;
}
