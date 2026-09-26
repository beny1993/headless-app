import { notFound } from 'next/navigation';
import { z } from 'zod';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { requireSession } from '@/lib/auth/session';
import { getOwnedOrder, type OwnedOrder } from '@/logic/checkout/get-order';

/** The `[orderId]` path segment is a stranger's input — reject a non-uuid. */
const orderIdSchema = z.uuid();

/**
 * The order behind a customer's `[orderId]` page (the checkout result and the
 * account order detail). `requireSession` is the re-login path: a session that
 * expired — during a gateway round trip, say — is bounced through OTP and back
 * to `returnTo(orderId)`. Owner-scoped by the session id through
 * `getOwnedOrder`: missing and not-owned are the same `notFound()`, so the page
 * never leaks that someone else's order exists.
 */
export async function loadOwnedOrder(
  orderId: string,
  returnTo: (orderId: string) => string,
): Promise<OwnedOrder> {
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) notFound();

  const session = await requireSession(returnTo(parsed.data));
  const order = await getOwnedOrder(parsed.data, session.user.id);
  if (!order) notFound();
  return order;
}

/** Where a card-to-card order sends its money — the `checkout.payment` content. */
export const readCardToCardPayment = async () =>
  (await SiteContentDao.getMany(['checkout.payment']))['checkout.payment'];
