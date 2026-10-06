import type { Metadata } from 'next';
import { z } from 'zod';
import { AddressDao } from '@/db/dao/AddressDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import {
  CheckoutForm,
  type ResumableOrder,
} from '@/features/checkout/checkout-form';
import { toSummaryLines } from '@/features/checkout/order-summary';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireSession } from '@/lib/auth/session';
import { CHECKOUT_RESUME_PARAM, PATHS } from '@/lib/constant/paths';
import { isZarinpalEnabled } from '@/lib/zarinpal/client';
import { toAddressResponse } from '@/lib/account/address';
import type { OwnedOrder } from '@/logic/checkout/get-order';
import { findResumableReceiptOrder } from '@/logic/checkout/resumable-order';

export const metadata: Metadata = { title: 'تکمیل خرید' };

/** `?resume=<orderId>`: anything but a uuid is no resume at all. */
const checkoutQuerySchema = z.object({
  [CHECKOUT_RESUME_PARAM]: z.uuid().optional().catch(undefined),
});

/** The waiting order as the form resumes it: its own lines and totals. */
const toResumableOrder = (order: OwnedOrder): ResumableOrder => ({
  orderId: order.id,
  lines: toSummaryLines(order.items),
  subtotal: order.subtotal,
  discount: order.discount,
  shippingFee: order.shippingFee,
  total: order.total,
});

/**
 * The checkout auth gate. A server component so a signed-out visitor is
 * redirected to `/login?next=/checkout` before any of the form ships — and comes
 * back to the same URL after OTP, with the localStorage cart untouched because it
 * never left the browser. The province rates are loaded here and handed down, so
 * the fee preview is a client-side lookup with no fetch; the client prices the
 * form shows are display-only and `POST /api/checkout` re-prices at order time.
 *
 * It also reads the shopper's card-to-card order still waiting for its receipt
 * (`findResumableReceiptOrder`, owner-scoped — the order `?resume=` names, else
 * their latest), the one the form leads back to. When the URL names it, the
 * form opens on its retry; the key makes that a fresh mount, since moving from
 * `/checkout` to `?resume=` would otherwise keep the old form's state.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession(PATHS.CHECKOUT);
  const { [CHECKOUT_RESUME_PARAM]: resumeId } = checkoutQuerySchema.parse(
    await searchParams,
  );
  const [rates, addresses, content, waiting] = await Promise.all([
    ShippingRateDao.listActive(),
    // Owner-scoped saved addresses, for the "select a saved address" prefill.
    AddressDao.listByUser(session.user.id),
    // The card-to-card cards and contact handles the payment step shows.
    SiteContentDao.getMany(['checkout.payment']),
    findResumableReceiptOrder(session.user.id, resumeId),
  ]);
  const resume = waiting ? toResumableOrder(waiting) : null;
  const resumed = resume !== null && resume.orderId === resumeId;

  return (
    <CheckoutForm
      key={resumed ? resume.orderId : 'cart'}
      rates={rates}
      defaultName={session.user.name ?? ''}
      defaultPhone={toLocalIranPhone(session.user.phoneNumber ?? '')}
      savedAddresses={addresses.map(toAddressResponse)}
      payment={content['checkout.payment']}
      zarinpalEnabled={isZarinpalEnabled()}
      resume={resume}
      resumed={resumed}
    />
  );
}
