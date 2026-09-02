// The read behind GET /api/orders/:id — the checkout result pages and account
// order history. Two DAOs (the order + its payment attempts), so it lives in
// src/logic/, not the route handler.
//
// Two security rules are load-bearing here:
//   · **Owner-scoped.** A session alone is never authorization — customers get
//     sessions too — so the order's `userId` must equal the caller's. A mismatch
//     returns `null`, which the route answers 404, the same as a missing order:
//     404-not-403 so the read never leaks that someone else's order exists.
//   · **Projection, never the raw row.** A payment row holds gateway secrets
//     (`authority`, `cardPan`, `gatewayResponse`, `failureReason`, `refId`); this
//     returns only `{ method, status, paidAt }`, so those can never reach a client.
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import type { OrderWithItems } from '@/db/schema/orders';
import type { PaymentMethod, PaymentStatus } from '@/lib/orders/order-status';

/** A payment attempt as a customer may see it — no gateway secrets. */
export type SafePayment = {
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | null;
};

/** An order the caller owns, with its item snapshots and safe payment view. */
export type OwnedOrder = OrderWithItems & { payments: SafePayment[] };

/**
 * The order `orderId` for `userId`, or `null` if it does not exist or belongs to
 * someone else — the two are deliberately indistinguishable to the caller.
 * `userId` comes from the authenticated session, never the URL.
 */
export const getOwnedOrder = async (
  orderId: string,
  userId: string,
): Promise<OwnedOrder | null> => {
  const order = await OrderDao.getById(orderId);
  if (!order || order.userId !== userId) return null;

  const payments: SafePayment[] = (await PaymentDao.listByOrder(orderId)).map(
    (payment) => ({
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt,
    }),
  );

  return { ...order, payments };
};
