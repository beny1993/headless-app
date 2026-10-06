// The reconcile/expiry sweep — the real inventory-drain fix that supersedes the
// interim per-user open-order cap. A Zarinpal checkout reserves stock into a
// `pending_payment` order; without this sweep that stock has no release path, so
// an abandoned order would hold it forever (denial of inventory). It also settles
// the "paid then closed the browser before the callback" case.
//
// One ordered run, VERIFY BEFORE EXPIRE:
//   Pass 1 — every stale pending attempt (authority older than 15 min) is
//     verified with the gateway and settled. A late success settles `paid` (or,
//     if the order already moved on, is flagged for manual refund); a confirmed
//     non-payment is marked `failed`, freeing the order for pass 2.
//   Pass 2 — every `pending_payment` order older than 1 h with no live
//     (pending/paid) attempt is transitioned to `failed`, which restocks.
//
// Run every five minutes inside the server while online payment is on
// (`src/logic/orders/order-sweeps.ts`), and by an admin through
// `POST /payments/zarinpal/reconcile`.
import * as Sentry from '@sentry/nextjs';
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import { getZarinpalClient, type ZarinpalClient } from '@/lib/zarinpal/client';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';
import { settlePendingPayment } from '@/logic/payments/verify';

/** How stale a pending attempt must be before pass 1 verifies it. */
const PAYMENT_STALE_MS = 15 * 60 * 1000;
/** How old a `pending_payment` order must be before pass 2 expires it. */
const ORDER_EXPIRY_MS = 60 * 60 * 1000;

export type ReconcileResult = {
  /** Late successes settled to `paid`. */
  verified: number;
  /** Confirmed non-payments marked `failed`. */
  failed: number;
  /** Late successes on an order that had moved on — flagged for manual refund. */
  refundFlagged: number;
  /** Abandoned orders expired to `failed` (stock restocked). */
  expired: number;
  /** Attempts whose verify threw (gateway down / bad response) and were skipped. */
  errored: number;
};

/**
 * Run one reconcile sweep. `client` is injectable for tests; it defaults to the
 * configured driver.
 */
export async function reconcilePayments(
  client: ZarinpalClient = getZarinpalClient(),
): Promise<ReconcileResult> {
  const now = Date.now();
  const result: ReconcileResult = {
    verified: 0,
    failed: 0,
    refundFlagged: 0,
    expired: 0,
    errored: 0,
  };

  // Pass 1 — verify stale pending attempts. Each settle is isolated: a verify
  // that throws (the real driver's fetch rejects, or the gateway returns an
  // unparseable body) must NOT abort the sweep, or one bad row would block every
  // expiry in pass 2 indefinitely. The row stays `pending`, so the next run
  // retries it. This is what keeps "flip to the real driver" a driver-only change.
  const stale = await PaymentDao.listPendingWithAuthorityOlderThan(
    new Date(now - PAYMENT_STALE_MS),
  );
  for (const payment of stale) {
    try {
      const outcome = await settlePendingPayment(payment, client);
      if (outcome === 'paid') result.verified += 1;
      else if (outcome === 'failed') result.failed += 1;
      else if (outcome === 'refund_flagged') result.refundFlagged += 1;
      // 'already_paid' — a concurrent callback settled it; nothing to count.
    } catch (error) {
      result.errored += 1;
      console.error(
        `[reconcile] verify/settle failed for payment ${payment.id}; left pending for a later run`,
        error,
      );
      // Money that the gateway may already have taken. The row stays `pending`
      // so the next run retries, which is exactly why this must not stay quiet
      // in a log — a row that fails every sweep looks like nothing at all.
      Sentry.captureException(error, {
        extra: { paymentId: payment.id, orderId: payment.orderId },
      });
    }
  }

  // Pass 2 — expire abandoned orders. Skip any order that still has a live
  // (pending or paid) attempt: a fresh retry may be mid-flight, and a paid one
  // means a callback settled it between the passes (its order will not be
  // pending_payment anyway).
  const expiredCandidates = await OrderDao.listExpiredPendingPayment(
    new Date(now - ORDER_EXPIRY_MS),
  );
  for (const order of expiredCandidates) {
    try {
      const expired = await db.transaction(async (tx) => {
        // Attempt insertion takes this same lock. A retry either commits before
        // this live-attempt read, or waits and rejects the expired status.
        if (
          (await OrderDao.lockStatus(tx, order.id)) !==
          ORDER_STATUSES.PENDING_PAYMENT
        )
          return false;
        const attempts = await PaymentDao.listByOrder(order.id, tx);
        if (
          attempts.some(
            (p) =>
              p.status === PAYMENT_STATUSES.PENDING ||
              p.status === PAYMENT_STATUSES.PAID,
          )
        )
          return false;
        await transitionOrder(
          tx,
          order.id,
          ORDER_STATUSES.PENDING_PAYMENT,
          ORDER_STATUSES.FAILED,
        );
        return true;
      });
      if (expired) result.expired += 1;
    } catch (error) {
      // A concurrent callback paid it mid-pass — its CAS out of pending_payment
      // won, ours lost. Leave it paid and move on.
      if (!(error instanceof InvalidTransitionError)) throw error;
    }
  }

  return result;
}
