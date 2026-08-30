import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_PATHS } from '@/lib/constant/paths';
import { auth } from './index';

export const getSession = async () =>
  auth.api.getSession({ headers: await headers() });

/**
 * Server-component session gate for the back office. Redirects to the sign-in
 * page when there is no valid session; returns the session otherwise.
 */
export const requireSession = async () => {
  const session = await getSession();
  if (!session?.user) redirect(AUTH_PATHS.SIGNIN);
  return session;
};
