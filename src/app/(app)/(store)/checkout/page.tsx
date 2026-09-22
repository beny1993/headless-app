import type { Metadata } from 'next';
import { AddressDao } from '@/db/dao/AddressDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CheckoutForm } from '@/features/checkout/checkout-form';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireSession } from '@/lib/auth/session';
import { PATHS } from '@/lib/constant/paths';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { toAddressResponse } from '@/lib/account/address';

export const metadata: Metadata = { title: 'تکمیل خرید' };

/**
 * The checkout auth gate. A server component so a signed-out visitor is
 * redirected to `/login?next=/checkout` before any of the form ships — and comes
 * back to the same URL after OTP, with the localStorage cart untouched because it
 * never left the browser. The province rates are loaded here and handed down, so
 * the fee preview is a client-side lookup with no fetch; the client prices the
 * form shows are display-only and `POST /api/checkout` re-prices at order time.
 */
export default async function Page() {
  const session = await requireSession(PATHS.CHECKOUT);
  const [rates, addresses, content] = await Promise.all([
    ShippingRateDao.listActive(),
    // Owner-scoped saved addresses, for the "select a saved address" prefill.
    AddressDao.listByUser(session.user.id),
    // The card-to-card cards and contact handles the payment step shows.
    SiteContentDao.getMany(['checkout.payment']),
  ]);

  return (
    <CheckoutForm
      rates={rates}
      defaultName={session.user.name ?? ''}
      defaultPhone={toLocalIranPhone(session.user.phoneNumber ?? '')}
      savedAddresses={addresses.map(toAddressResponse)}
      payment={content['checkout.payment']}
      zarinpalEnabled={
        getEnvVariable(VARS.APP_CONFIG_ZARINPAL_ENABLED, false, '') === 'true'
      }
    />
  );
}
