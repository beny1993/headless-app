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
// A `pending_payment` cancel can race a Zarinpal verify: the verify's CAS then
// loses and its payment write rolls back, so money taken at the gateway sits on
// a cancelled order — the window an admin cancel already has, and the reason
// the cancelled page points to support for a refund.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { OPEN_ORDER_STATUSES, ORDER_STATUSES } from '@/lib/orders/order-status';
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
  | { outcome: 'not_allowed' };

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
