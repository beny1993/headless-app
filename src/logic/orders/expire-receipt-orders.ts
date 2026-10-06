// The receipt-expiry sweep: a card-to-card order whose receipt has not arrived
// within RECEIPT_WAIT_MS is cancelled, which returns its reserved stock and
// frees the shopper's open-order slot. Run every 15 minutes inside the server
// (`src/logic/orders/order-sweeps.ts`); `now` is a parameter so the tests need
// no clock.
//
// Each order moves in its own transaction through `transitionOrder`, whose CAS
// takes the order's row lock — the one a receipt upload takes too — so a
// receipt that lands at the last moment and the sweep queue behind each other,
// and whichever is second finds the order already moved and leaves it.
//
// Benyamin's call (2026-10-06): two hours, knowing that through the site an
// order only waits when its screenshot failed to upload — so the shopper has
// usually paid, and the cancelled page sends them to support for the refund.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { formatNumber } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';

const HOUR_MS = 60 * 60 * 1000;

/** How long a card-to-card order waits for its receipt before it is cancelled. */
export const RECEIPT_WAIT_MS = 2 * HOUR_MS;

/** Stored as the cancel's reason — the shopper reads it after «دلیل:». */
export const RECEIPT_EXPIRED_REASON = `رسید پرداخت در مهلت ${formatNumber(RECEIPT_WAIT_MS / HOUR_MS)} ساعت نرسید`;

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
      if (!(error instanceof InvalidTransitionError)) throw error;
    }
  }
  return expired;
}
