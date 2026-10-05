// The order state machine's one write path. Every status change goes through
// `transitionOrder`; nothing else may `UPDATE orders SET status`. It composes
// the DAOs (the CAS, the restock, the COD-payment flip) rather than touching the
// database itself — multi-DAO orchestration is exactly what src/logic/ is for.
//
// The `tx` the caller passes is not optional and not decorative: the CAS and its
// side effects must commit together or not at all, so the caller owns the
// transaction boundary. The Zarinpal verify callback (story 15) relies on this —
// it marks the payment row paid and CASes `pending_payment → paid` in one
// transaction, and if the CAS loses (a second verify already won), the payment
// write rolls back with it.
import type { Tx } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ProductDao } from '@/db/dao/ProductDao';
import type { Order } from '@/db/schema/orders';
import {
  byProductId,
  canTransition,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';

/**
 * Thrown when a transition does not happen: either the `from → to` pair is not a
 * legal edge, or the order was not in `from` when the CAS ran (a lost race
 * against a concurrent transition, or a stale caller). Both are the same outcome
 * to a caller — the order did not move — so they share one error type.
 */
export class InvalidTransitionError extends Error {
  constructor(
    readonly orderId: string,
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Illegal order transition ${from} -> ${to} for order ${orderId}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Moves an order from `from` to `to`, applying the transition's side effects, all
 * inside the caller's transaction `tx`.
 *
 * The legal-edges map is consulted first, so an illegal pair is rejected before
 * touching the database. Then the compare-and-set (`… WHERE id = ? AND status =
 * from`) both performs the move and makes it race-safe: of two concurrent
 * transitions out of the same status, exactly one matches the row and the other
 * gets zero rows and an `InvalidTransitionError`.
 *
 * Side effects, in the same transaction as the CAS:
 *   · into `cancelled` or `failed` — restock every line item (the stock reserved
 *     at checkout is returned).
 *   · into `cancelled` — store `cancellationReason`, in the CAS itself. A reason
 *     passed with any other move is ignored: the column says why an order was
 *     cancelled, and nothing else.
 *   · into `delivered` for a COD order — flip the pending COD payment to `paid`.
 *
 * `awaiting_receipt → processing` (a card-to-card order accepted) has none.
 */
export const transitionOrder = async (
  tx: Tx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  { cancellationReason }: { cancellationReason?: string } = {},
): Promise<Order> => {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(orderId, from, to);
  }

  const updated = await OrderDao.casStatus(
    tx,
    orderId,
    from,
    to,
    to === ORDER_STATUSES.CANCELLED ? cancellationReason : undefined,
  );
  if (!updated) {
    throw new InvalidTransitionError(orderId, from, to);
  }

  if (to === ORDER_STATUSES.CANCELLED || to === ORDER_STATUSES.FAILED) {
    // Restock in productId order: two orders that share products, cancelled
    // concurrently, then take the product-row locks in the same order and cannot
    // deadlock (Postgres would abort one with 40P01). getItems is createdAt-
    // ordered for display, which gives no such cross-order guarantee, so sort a
    // copy here by the one key every order agrees on.
    // ponytail: this covers the single-order cancels this story ships; a future
    // batch-cancel that restocks many orders in one tx must sort the *combined*
    // item set by productId for the same reason.
    const items = (await OrderDao.getItems(tx, orderId)).sort(byProductId);
    for (const item of items) {
      await ProductDao.restock(tx, item.productId, item.qty);
    }
  }

  if (
    to === ORDER_STATUSES.DELIVERED &&
    updated.paymentMethod === PAYMENT_METHODS.COD
  ) {
    await PaymentDao.markCodPaid(tx, orderId);
  }

  return updated;
};
