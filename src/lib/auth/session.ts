import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLES } from '@/db/schema/auth';
import { AUTH_PATHS, PATHS } from '@/lib/constant/paths';
import { auth } from './index';

export const getSession = async () =>
  auth.api.getSession({ headers: await headers() });

/**
 * Server-component gate for the back office. Redirects to sign-in when there is
 * no session, and to the storefront when the session is not an admin's.
 *
 * A session alone is not authorization: customers get sessions too (phone OTP),
 * so the role check is what actually keeps the back office admin-only. Every
 * new admin page and admin API route must go through this.
 */
export const requireAdmin = async () => {
  const session = await getSession();
  if (!session?.user) redirect(AUTH_PATHS.SIGNIN);
  if (session.user.role !== ROLES.ADMIN) redirect(PATHS.HOME);
  return session;
};
