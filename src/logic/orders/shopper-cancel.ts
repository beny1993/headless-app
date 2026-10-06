// A shopper's cancel of their own order — the way out of checkout's open-order
// cap, which counts exactly the orders this may cancel (`OPEN_ORDER_STATUSES`:
// waiting for a receipt or an online payment). It drives the one state machine
// (`transitionOrder`), so the restock and the reason ride on the CAS.
//
// The read is `lockForReceipt`: owner-scoped (another shopper's order is
// `not_found`, never forbidden — the route answers 404) and the same row lock a
// receipt upload takes, so a cancel and the receipt that would accept the order
// queue behind each other and only one wins.
//
// No cancel while an online payment is still going through: a shopper who paid
// at the gateway and never came back would otherwise cancel an order the
// reconcile sweep then verifies as paid — `verify.ts` keeps the money with
// `needsManualRefund` on a cancelled order. Race-free under the lock: a new
// payment attempt takes the same order row (`request.ts`), so either the
// attempt lands first and this sees it, or the cancel does and the attempt is
// refused. The order waits for its verify, or for the sweep to expire it.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import {
  OPEN_ORDER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';

/** Stored as the cancel's reason: the shopper reads it, the admin sees who. */
export const SHOPPER_CANCEL_REASON = 'به درخواست خریدار لغو شد';

type ShopperCancelResult =
  | { outcome: 'ok' }
  /** Missing, or someone else's — one answer. */
  | { outcome: 'not_found' }
  /** No longer open: accepted, paid, shipped, or already cancelled. */
  | { outcome: 'not_allowed' }
  /** An online payment attempt is still live on it: wait for its verify. */
  | { outcome: 'payment_pending' };

export const shopperCancelOrder = async (
  orderId: string,
  userId: string,
): Promise<ShopperCancelResult> => {
  try {
    return await db.transaction(async (tx) => {
      const order = await OrderDao.lockForReceipt(tx, orderId, userId);
      if (!order) return { outcome: 'not_found' as const };
      if (!OPEN_ORDER_STATUSES.includes(order.status)) {
        return { outcome: 'not_allowed' as const };
      }
      // A card-to-card order's own payment row stays pending until delivery;
      // only a gateway attempt can still turn into money.
      const attempts = await PaymentDao.listByOrder(orderId, tx);
      if (
        attempts.some(
          (attempt) =>
            attempt.method === PAYMENT_METHODS.ZARINPAL &&
            (attempt.status === PAYMENT_STATUSES.PENDING ||
              attempt.status === PAYMENT_STATUSES.PAID),
        )
      ) {
        return { outcome: 'payment_pending' as const };
      }
      await transitionOrder(
        tx,
        orderId,
        order.status,
        ORDER_STATUSES.CANCELLED,
        { cancellationReason: SHOPPER_CANCEL_REASON },
      );
      return { outcome: 'ok' as const };
    });
  } catch (error) {
    // Under the row lock the status cannot move between the read and the CAS;
    // this is the defensive answer should it ever.
    if (error instanceof InvalidTransitionError) {
      return { outcome: 'not_allowed' };
    }
    throw error;
  }
};
