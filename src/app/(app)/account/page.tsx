import type { Metadata } from 'next';
import { AddressDao } from '@/db/dao/AddressDao';
import { OrderDao } from '@/db/dao/OrderDao';
import { PetDao } from '@/db/dao/PetDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { AccountView } from '@/features/account/account-view';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireSession } from '@/lib/auth/session';
import { PATHS } from '@/lib/constant/paths';
import { toAddressResponse } from '@/lib/hono/routes/me-addresses';
import { toOrderSummary } from '@/lib/hono/routes/me-orders';
import { toPetResponse } from '@/lib/hono/routes/me-pets';

export const metadata: Metadata = { title: 'حساب کاربری' };

/**
 * The account page: orders, pet profiles, saved addresses and the profile tab.
 *
 * A server component so `requireSession` is the auth gate — a signed-out visitor
 * is bounced to `/login?next=/account` (via `safeNextPath`) and comes back here.
 * Every tab's data is loaded owner-scoped by the SESSION id, never a URL, and
 * projected through the exact same functions the `/api/me/*` routes use, so the
 * server-rendered first paint and any later client fetch share one shape. The
 * interactive tabs then own their own state (see `AccountView`).
 */
export default async function Page() {
  const session = await requireSession(PATHS.ACCOUNT);
  const userId = session.user.id;

  const [pets, addresses, orders, rates] = await Promise.all([
    PetDao.listByUser(userId),
    AddressDao.listByUser(userId),
    OrderDao.listByUser(userId),
    ShippingRateDao.list(),
  ]);

  return (
    <AccountView
      name={session.user.name ?? ''}
      phone={toLocalIranPhone(session.user.phoneNumber ?? '')}
      orders={orders.map(toOrderSummary)}
      pets={pets.map(toPetResponse)}
      addresses={addresses.map(toAddressResponse)}
      provinces={rates.map((rate) => ({
        provinceId: rate.provinceId,
        name: rate.name,
      }))}
    />
  );
}
