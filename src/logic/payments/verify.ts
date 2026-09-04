// The verify-and-settle path — the ONLY writer of `payments.status = paid`, and
// the security-critical heart of the payment flow. Shared by the unauthenticated
// gateway callback and the admin reconcile sweep, so it lives in src/logic/, not
// a route handler. It composes the DAOs and the order state machine; idempotency
// rests on two DB facts, never on gateway behavior:
//
//   · `payments.authority` is unique — a replayed callback finds the one row.
//   · both the order CAS (`pending_payment → paid`) and the payment CAS
//     (`markPaid`, `status <> 'paid'`) are compare-and-set, in ONE transaction —
//     a replay or a racing verify loses a CAS and settles nothing twice.
//
// The amount handed to the gateway is ALWAYS the stored `payment.amount`, never
// anything from the request: the callback is unauthenticated and its query is not
// trusted for money.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import type { Payment } from '@/db/schema/orders';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import type { ZarinpalClient } from '@/lib/zarinpal/client';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';

/**
 * What settling did, for the caller's counters and the tests' assertions:
 *   · `paid` — verified and this call moved the order to `paid`.
 *   · `already_paid` — an idempotent no-op (a replay, or a race this call lost).
 *   · `failed` — verify rejected (NOK, amount mismatch, gateway error); the
 *     order stays `pending_payment` so the shopper can retry.
 *   · `refund_flagged` — verify succeeded (money taken) but the order had already
 *     moved on (expired to `failed`/`cancelled`, or paid by another attempt). The
 *     payment is kept `paid` and flagged for manual refund; stock is untouched.
 */
export type SettleOutcome =
  'paid' | 'already_paid' | 'failed' | 'refund_flagged';

const NOK_REASON = 'user cancelled at gateway';

/**
 * Handle a gateway callback for a known payment row. `NOK` records the failure
 * and leaves the order `pending_payment` (retry allowed); `OK` verifies with the
 * gateway and settles. The `payment.status === paid` fast path is FIRST so a
 * replayed NOK on an already-paid order can never mark it failed.
 */
export async function handleCallback(
  payment: Payment,
  status: 'OK' | 'NOK',
  client: ZarinpalClient,
): Promise<SettleOutcome> {
  if (payment.status === PAYMENT_STATUSES.PAID) return 'already_paid';

  if (status === 'NOK') {
    await PaymentDao.markFailed(db, payment.id, {
      failureReason: NOK_REASON,
      gatewayResponse: { status: 'NOK' },
    });
    // Whether the CAS matched (was pending) or not (already failed), the outcome
    // the caller cares about is the same: this attempt did not pay.
    return 'failed';
  }

  return settlePendingPayment(payment, client);
}

/**
 * Verify one pending attempt with the gateway and settle it. Used directly by the
 * reconcile sweep and by the OK branch of the callback.
 *
 * The verify call is made OUTSIDE the transaction (it is a network round-trip; a
 * held transaction across it would pin a connection). The settle that follows is
 * order-CAS-first, in one transaction, so the payment write and the order move
 * commit together — the carried-in security constraint.
 */
export async function settlePendingPayment(
  payment: Payment,
  client: ZarinpalClient,
): Promise<SettleOutcome> {
  // Short-circuit ONLY on paid — a `failed` row (a reconcile that verified too
  // early, say) must still be settleable by a genuine later verify-OK, which is
  // exactly why markPaid's CAS is `<> 'paid'` and not `= 'pending'`.
  if (payment.status === PAYMENT_STATUSES.PAID) return 'already_paid';
  if (!payment.authority) {
    // Only authority-bearing (Zarinpal) rows reach here; a COD row would be a bug.
    throw new Error(
      `settlePendingPayment requires an authority-bearing payment, got ${payment.id}`,
    );
  }

  const verify = await client.verifyPayment({
    amountToman: payment.amount,
    authority: payment.authority,
  });

  if (!verify.ok) {
    await PaymentDao.markFailed(db, payment.id, {
      failureReason: `zarinpal verify failed (code ${verify.code}): ${verify.message}`,
      gatewayResponse: { code: verify.code, message: verify.message },
    });
    return 'failed';
  }

  // Verify succeeded — the money moved. Everything below is idempotent under a
  // replay or a concurrent second verify.
  const paidFields = {
    refId: verify.refId,
    cardPan: verify.cardPan,
    paidAt: new Date(),
  };

  return db.transaction(async (tx) => {
    try {
      await transitionOrder(
        tx,
        payment.orderId,
        ORDER_STATUSES.PENDING_PAYMENT,
        ORDER_STATUSES.PAID,
      );
      const paid = await PaymentDao.markPaid(tx, payment.id, {
        ...paidFields,
        gatewayResponse: { verify },
      });
      if (!paid) {
        // The order CAS won but no payment row flipped `paid` — a `paid` order
        // with no paid payment, the same corruption markCodPaid refuses. Throw
        // so the transaction (and the order move) rolls back.
        throw new Error(
          `markPaid matched no row after a won order CAS for payment ${payment.id}`,
        );
      }
      return 'paid';
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) throw error;

      // The order was not `pending_payment`: either already `paid` (a replay/race
      // this call lost) or expired to `failed`/`cancelled` while the money was
      // taken. Read which, then mark the payment paid regardless (the money is
      // real). markPaid's CAS decides the outcome.
      const orderStatus = await OrderDao.getStatus(tx, payment.orderId);
      const paid = await PaymentDao.markPaid(tx, payment.id, {
        ...paidFields,
        gatewayResponse: { verify, needsManualRefund: true, orderStatus },
      });
      // null: THIS attempt was already `paid` — a pure idempotent replay, no flag.
      if (!paid) return 'already_paid';
      // row: money collected for an order that had already moved on. Keep it
      // paid and flagged; never restock, never re-decrement, never auto-refund.
      return 'refund_flagged';
    }
  });
}
