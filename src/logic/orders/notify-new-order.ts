// «Nobody sits on /admin-panel/orders all day.» This is the SMS that tells them
// an order came in — sent to every admin who has a phone number, once per real
// order, from the two places an order becomes real: a card-to-card order's
// first receipt, which accepts it (`uploadReceipt`), and a Zarinpal payment
// that settled `paid`.
//
// Two properties this module owes its callers, because both hook sites `void`
// the promise it returns rather than awaiting it:
//
//   · It NEVER rejects. Node 24 exits the process on an unhandled rejection, and
//     this promise outlives the checkout response it belongs to.
//   · It never delays them. The send starts after the transaction has committed,
//     so the shopper's 201 and the reconcile sweep's counters are identical
//     whether the provider answered, refused or hung. No timeout of its own: the
//     SMS.ir driver bounds its own request (SEND_TIMEOUT_MS), and a hung promise
//     nobody awaits costs nothing.
//
// What it says is deliberately thin — the order number, the total, the method.
// An SMS is not a secure channel and the admin panel is one tap away, so no
// customer name, phone, city or address travels here.
import * as Sentry from '@sentry/nextjs';
import { OrderDao } from '@/db/dao/OrderDao';
import { UserDao } from '@/db/dao/UserDao';
import { formatToman, toPersianDigits } from '@/lib/format';
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { newOrderSms, sendSms } from '@/lib/sms';
import type { SettleOutcome } from '@/logic/payments/verify';

/**
 * The alert for one order, as the SMS seam carries it. Pure.
 *
 * The order number goes through `toPersianDigits` and NOT `formatNumber`: a
 * thousands separator in an order number reads as a price. The total does go
 * through `formatToman`, which is the only place money is rendered.
 */
export const newOrderAlert = (order: {
  orderNo: number;
  total: number;
  paymentMethod: PaymentMethod;
}) =>
  newOrderSms({
    ORDER: toPersianDigits(order.orderNo),
    AMOUNT: formatToman(order.total),
    // The admin panel's own name for the method, so the SMS and the orders
    // page read the same.
    METHOD: PAYMENT_METHOD_LABELS[order.paymentMethod],
  });

/**
 * Whether a settled payment is news to an admin. Pure, and the whole of the
 * decision at the `settlePendingPayment` hook:
 *
 *   · `paid` — this call turned a pending checkout into a sale. Tell them.
 *   · `already_paid` — a replayed callback, or a race this call lost; whoever
 *     won it sent the alert.
 *   · `failed` — no money moved.
 *   · `refund_flagged` — money in hand, but no order to pack: a manual refund,
 *     a different message, and a story of its own.
 */
export const notifiesOnSettle = (outcome: SettleOutcome): boolean =>
  outcome === 'paid';

/**
 * One report per failed alert: the order number, and nothing else.
 *
 * Its own try/catch because it runs inside the catch below: a console that has
 * lost its pipe, or a Sentry client that throws, would otherwise leave this
 * un-awaited promise rejected — and Node 24 exits the process on an unhandled
 * rejection. A report that cannot be made is not worth the container.
 */
const report = (error: unknown, orderNo?: number) => {
  try {
    console.error(
      `[new-order-sms] alert failed for order ${orderNo ?? 'unknown'}`,
      error,
    );
    // At most the order number — never an admin's phone, never anything of the
    // customer's. That is the privacy contract in src/lib/sentry.ts, and the
    // reason the console-breadcrumb integration is removed there.
    Sentry.captureException(error, { extra: { orderNo } });
  } catch {
    // Nowhere left to report to.
  }
};

/**
 * Tell the admins about order `orderId`. Catches everything; never rejects.
 *
 * Zero admins with a phone — a fresh clone — is not a failure: nothing is sent
 * and nothing is reported. One admin's send failing does not skip the others.
 */
export async function notifyAdminsOfNewOrder(orderId: string): Promise<void> {
  let orderNo: number | undefined;
  try {
    const admins = await UserDao.listAdminsWithPhone();
    if (admins.length === 0) return;

    const order = await OrderDao.getById(orderId);
    if (!order) {
      throw new Error(`no order ${orderId} to alert about`);
    }
    orderNo = order.orderNo;

    const message = newOrderAlert(order);
    // allSettled, not a loop that stops: one wedged number must not silence
    // every other admin. One report is enough to say the alert did not land.
    const results = await Promise.allSettled(
      admins.map((admin) => sendSms(admin.phoneNumber, message)),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) report(failed.reason, orderNo);
  } catch (error) {
    report(error, orderNo);
  }
}
