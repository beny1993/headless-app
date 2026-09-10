import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLES } from '@/db/schema/auth';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { auth } from './index';
import { loginPath } from './next-path';

// Layouts and pages can both enforce the same boundary during one render. React
// cache keeps that defense-in-depth from doing two Better Auth database reads,
// while a later navigation/render still gets a fresh session check.
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Server-component gate for pages that belong to one customer.
 *
 * Sends a signed-out visitor to `/login`, remembering where they were headed so
 * the code they are about to request lands them back on it. A session is all
 * this checks — the page itself is still responsible for scoping every read to
 * `session.user.id` and never to an id from the URL.
 */
export const requireSession = async (returnTo: string) => {
  const session = await getSession();
  if (!session?.user) redirect(loginPath(returnTo));
  return session;
};

/**
 * Server-component gate for the admin panel. Redirects to sign-in when there is
 * no session, and to the storefront when the session is not an admin's.
 *
 * A session alone is not authorization: customers get sessions too (phone OTP),
 * so the role check is what actually keeps the admin panel admin-only. Every
 * new admin page must go through this; admin *API* routes get the same rule as
 * status codes from `src/lib/hono/middleware/auth.ts`.
 *
 * Sign-in is the storefront's `/login` — there is one login for the whole site
 * now that admins are provisioned by phone (`pnpm create-admin`). A signed-out
 * admin lands back on the panel afterwards; a signed-in customer is sent to the
 * storefront instead, because for them no amount of signing in would help.
 */
export const requireAdmin = async () => {
  const session = await getSession();
  if (!session?.user) redirect(loginPath(PROTECTED_PATHS.INDEX));
  if (session.user.role !== ROLES.ADMIN) redirect(PATHS.HOME);
  return session;
};
