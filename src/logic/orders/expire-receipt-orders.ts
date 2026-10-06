// The receipt-expiry sweep: a card-to-card order whose receipt has not arrived
// within RECEIPT_WAIT_MS is cancelled, which returns its reserved stock and
// frees the shopper's open-order slot. Run on the server's sweep schedule
// (`src/logic/orders/order-sweeps.ts`); `now` is a parameter so the tests need
// no clock.
//
// Each order moves in its own transaction through `transitionOrder`, whose CAS
// takes the order's row lock — the one a receipt upload takes too — so a
// receipt that lands at the last moment and the sweep queue behind each other,
// and whichever is second finds the order already moved and leaves it. One at a
// time on purpose: the sweep never holds more than one pool connection or one
// order's locks, and a run only ever finds a handful. An order that fails is
// reported with its id and the rest still expire — one bad row must not hold
// every other order's stock, run after run.
//
// The wait is RECEIPT_WAIT_MS (src/lib/orders/receipt.ts), knowing that through
// the site an order only waits when its screenshot failed to upload, so the
// shopper has usually paid, and the cancelled page sends them to support for
// the refund.
import * as Sentry from '@sentry/nextjs';
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { formatNumber } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { RECEIPT_WAIT_MINUTES, RECEIPT_WAIT_MS } from '@/lib/orders/receipt';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';

/** Stored as the cancel's reason — the shopper reads it after «دلیل:». */
export const RECEIPT_EXPIRED_REASON = `رسید پرداخت در مهلت ${formatNumber(RECEIPT_WAIT_MINUTES)} دقیقه نرسید`;

/** Cancels every card-to-card order still waiting past the wait; returns how many. */
export async function expireReceiptOrders(now = Date.now()): Promise<number> {
  const ids = await OrderDao.listAwaitingReceiptBefore(
    new Date(now - RECEIPT_WAIT_MS),
  );
  let expired = 0;
  for (const id of ids) {
    try {
      await db.transaction((tx) =>
        transitionOrder(
          tx,
          id,
          ORDER_STATUSES.AWAITING_RECEIPT,
          ORDER_STATUSES.CANCELLED,
          { cancellationReason: RECEIPT_EXPIRED_REASON },
        ),
      );
      expired += 1;
    } catch (error) {
      // Its receipt, the shopper or an admin moved it first: leave it.
      if (error instanceof InvalidTransitionError) continue;
      Sentry.captureException(error, { extra: { orderId: id } });
      console.error(
        `[sweep] could not expire order ${id}; the next run retries`,
        error,
      );
    }
  }
  return expired;
}
