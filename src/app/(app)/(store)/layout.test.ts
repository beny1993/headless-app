// The maintenance gate. Wrong in one direction it opens a half-stocked shop to
// the public; wrong in the other it shuts the admins stocking it out of the
// storefront they need to check. Every combination of flag and role is pinned.
//
// `getSession` is mocked at the module edge — it needs a request scope — and
// the gate's own decision runs for real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { MaintenancePage } from '@/features/storefront/maintenance/maintenance-page';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { default: StoreLayout } = await import('./layout');

const PAGE = 'the requested page';

const render = async () =>
  (await StoreLayout({ children: PAGE })) as unknown as
    typeof PAGE | { type: unknown };

const signedInAs = (role: string | null) =>
  getSession.mockResolvedValue(role ? { user: { role } } : null);

afterEach(() => {
  vi.unstubAllEnvs();
  getSession.mockReset();
});

describe('the storefront maintenance gate', () => {
  describe('with maintenance mode off', () => {
    it('serves the page without reading the session', async () => {
      vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', '');
      expect(await render()).toBe(PAGE);
      // Off is the normal state of a live shop: no session read per page view.
      expect(getSession).not.toHaveBeenCalled();
    });

    it('takes only the string `true`', async () => {
      signedInAs(null);
      for (const value of ['1', 'yes', 'TRUE', 'false']) {
        vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', value);
        expect(await render(), value).toBe(PAGE);
      }
    });
  });

  describe('with maintenance mode on', () => {
    beforeEach(() => vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', 'true'));

    it('shows a signed-out visitor the maintenance page', async () => {
      signedInAs(null);
      expect(await render()).toMatchObject({ type: MaintenancePage });
    });

    it('reads a padded ` true ` as on', async () => {
      vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', ' true ');
      signedInAs(null);
      expect(await render()).toMatchObject({ type: MaintenancePage });
    });

    it('shows a signed-in customer the maintenance page', async () => {
      signedInAs(ROLES.CUSTOMER);
      expect(await render()).toMatchObject({ type: MaintenancePage });
    });

    it('serves the page to an admin', async () => {
      signedInAs(ROLES.ADMIN);
      expect(await render()).toBe(PAGE);
    });
  });
});
