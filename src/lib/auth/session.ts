import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLES } from '@/db/schema/auth';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { auth } from './index';
import { loginPath } from './next-path';

export const getSession = async () =>
  auth.api.getSession({ headers: await headers() });

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
