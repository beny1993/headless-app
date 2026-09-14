// Starting a Zarinpal payment: turn an owned, awaiting-payment order into a
// gateway authority + a redirect URL, and persist the pending attempt keyed by
// that authority. Two DAOs plus the gateway client, so it lives in src/logic/.
//
// Owner-scoping is load-bearing: the order id comes from the request, so the
// order must belong to the SESSION user (passed by the route from `c.get('user')`,
// never the body). A mismatch or a missing order is the SAME 404 — the read never
// leaks that someone else's order exists.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { API_PATHS } from '@/lib/constant/paths';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { getAppBaseUrl } from '@/lib/utils/env';
import { getZarinpalClient } from '@/lib/zarinpal/client';

/**
 * A payment-request that the server refused. `status` is the HTTP code the route
 * answers (404 for not-found / not-owned — deliberately indistinguishable; 422
 * for an order that cannot start a Zarinpal payment); `message` is the Persian,
 * customer-facing summary. Distinct from a thrown `Error` (→ 500) the way
 * `CheckoutError` is: this is expected, client-visible refusal.
 */
export class PaymentRequestError extends Error {
  constructor(
    readonly status: 404 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentRequestError';
  }
}

const ORDER_NOT_FOUND = 'سفارش یافت نشد';
const NOT_AWAITING_PAYMENT = 'این سفارش در انتظار پرداخت نیست.';
const NOT_A_ZARINPAL_ORDER = 'این سفارش با درگاه پرداخت آنلاین ثبت نشده است.';

/**
 * Start a Zarinpal payment for `orderId` on behalf of `userId`.
 *
 * The order must belong to the caller, be `pending_payment`, and be a `zarinpal`
 * order. Each call mints a fresh authority and a new `pending` payment row (a
 * retry after a failed attempt is a legitimate new row — the order-status CAS is
 * what guarantees at most one ever reaches `paid`). Returns the URL the FE sends
 * the browser to.
 */
export async function requestZarinpalPayment(
  userId: string,
  orderId: string,
): Promise<{ redirectUrl: string }> {
  const order = await OrderDao.getById(orderId);
  // Not found and not-owned are the same answer — no existence leak.
  if (!order || order.userId !== userId) {
    throw new PaymentRequestError(404, ORDER_NOT_FOUND);
  }
  if (order.status !== ORDER_STATUSES.PENDING_PAYMENT) {
    throw new PaymentRequestError(422, NOT_AWAITING_PAYMENT);
  }
  if (order.paymentMethod !== PAYMENT_METHODS.ZARINPAL) {
    throw new PaymentRequestError(422, NOT_A_ZARINPAL_ORDER);
  }

  const client = getZarinpalClient();
  const { authority, redirectUrl } = await client.requestPayment({
    amountToman: order.total,
    callbackUrl: `${getAppBaseUrl()}${API_PATHS.PAYMENT_CALLBACK}`,
    description: `پرداخت سفارش شماره ${order.orderNo} - اسموکی`,
    orderId: order.id,
  });

  // Persist the attempt keyed by the authority (the idempotency anchor). The
  // money has not moved yet — an authority is issued before payment — so a
  // failure here just means the shopper retries; nothing is charged.
  // ponytail: request throw → shared 500 for v1; a 502 mapping (gateway is down,
  // not us) is a nicety to add if request failures become common.
  await db.transaction(async (tx) => {
    // The network request above holds no DB lock. Expiry/cancellation/payment
    // may have won meanwhile, so re-check under the same order lock expiry uses.
    const status = await OrderDao.lockStatus(tx, order.id);
    if (status !== ORDER_STATUSES.PENDING_PAYMENT) {
      throw new PaymentRequestError(422, NOT_AWAITING_PAYMENT);
    }
    await PaymentDao.create(
      {
        orderId: order.id,
        method: PAYMENT_METHODS.ZARINPAL,
        status: PAYMENT_STATUSES.PENDING,
        amount: order.total,
        authority,
      },
      tx,
    );
  });

  return { redirectUrl };
}
