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
//     A receipt row holds its storage key; this returns only `{ id, createdAt }`.
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ReceiptDao } from '@/db/dao/ReceiptDao';
import type { OrderWithItems } from '@/db/schema/orders';
import type { PaymentMethod, PaymentStatus } from '@/lib/orders/order-status';

/** A payment attempt as a customer may see it — no gateway secrets. */
export type SafePayment = {
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | null;
};

/**
 * A card-to-card receipt as its uploader may see it: the id (the last segment
 * of the authenticated URL that serves it) and when it arrived. Never the
 * storage key — nothing a customer holds can name the object.
 */
export type SafeReceipt = { id: string; createdAt: Date };

/**
 * An order the caller owns, with its item snapshots, safe payment view and
 * receipts. `cancellationReason` rides along on the row: the admin wrote it for
 * this shopper to read.
 */
export type OwnedOrder = OrderWithItems & {
  payments: SafePayment[];
  receipts: SafeReceipt[];
};

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
  const receipts: SafeReceipt[] = (await ReceiptDao.listByOrder(orderId)).map(
    ({ id, createdAt }) => ({ id, createdAt }),
  );

  return { ...order, payments, receipts };
};
