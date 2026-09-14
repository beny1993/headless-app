import { ROLES } from '@/db/schema/auth';
import { MaintenancePage } from '@/features/storefront/maintenance/maintenance-page';
import { getSession } from '@/lib/auth/session';
import { getEnvVariable, VARS } from '@/lib/utils/env';

// The maintenance gate for every public storefront page. `login/` sits outside
// this group on purpose — an admin has to be able to sign in while the shop is
// closed — and the admin panel is another group with its own `requireAdmin`.
//
// A layout rather than `proxy.ts`: it reuses the session read the admin panel
// already trusts, and no matcher can accidentally catch `/api/ready`, the probe
// Coolify restarts the container on.
//
// ponytail: hides the shop, does not protect it — `/api` stays open and the
// page answers 200, not 503. Fine before launch; move the check to `proxy.ts`
// if the shop ever has to close while live and indexed.
export default async function StoreLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (getEnvVariable(VARS.APP_CONFIG_MAINTENANCE_MODE, false, '') !== 'true') {
    return children;
  }

  const session = await getSession();
  if (session?.user.role === ROLES.ADMIN) return children;

  return <MaintenancePage />;
}
