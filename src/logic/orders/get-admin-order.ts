// The read behind the admin order detail — the page and GET /api/admin/orders/:id
// both consume it, and it is what the admin transition endpoint returns. Two DAOs
// (the order + its payment attempts), so it lives in src/logic/, like getOwnedOrder.
//
// This is the DELIBERATE ADMIN PROJECTION, and it is wider than the customer's
// (`OwnedOrder`, which exposes only `{ method, status, paidAt }`): an operator
// legitimately needs the gateway authority, ref id, method, amount and the masked
// card to reconcile a payment or answer support. But it is STILL a projection,
// not the raw row — `gatewayResponse` (the verbatim gateway blob) and the internal
// row ids/timestamps are dropped by the explicit field map below, so they can
// never reach a client, and — since the page reads THIS, not the raw row — never
// ride along in an RSC payload either. Not owner-scoped: the admin may read any
// order (that is the point), keyed by the uuid `id`, authorized by `requireAdmin`.
import { z } from 'zod';
import { OrderDao } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ReceiptDao } from '@/db/dao/ReceiptDao';
import type { OrderWithItems, Payment } from '@/db/schema/orders';
import type { PaymentMethod, PaymentStatus } from '@/lib/orders/order-status';

/** A payment attempt as an ADMIN may see it — everything but the raw gateway blob. */
export type AdminPayment = {
  method: PaymentMethod;
  status: PaymentStatus;
  /** Integer Toman. */
  amount: number;
  /** Zarinpal's authority id (its per-attempt idempotency key); null for COD. */
  authority: string | null;
  /** Gateway reference id, set on a successful verify. */
  refId: string | null;
  /** Masked card number the gateway returned, if any. */
  cardPan: string | null;
  failureReason: string | null;
  needsManualRefund: boolean;
  paidAt: Date | null;
  createdAt: Date;
};

/**
 * A card-to-card receipt as an admin sees it: what it is and how big, for the
 * list on the order page. Not the storage key — the admin reads the bytes
 * through the authenticated route by id, like the shopper.
 */
export type AdminReceipt = {
  id: string;
  contentType: string;
  size: number;
  createdAt: Date;
};

/** An order with its item snapshots, the admin payment view and its receipts. */
export type AdminOrder = OrderWithItems & {
  payments: AdminPayment[];
  receipts: AdminReceipt[];
};

const refundFlagSchema = z
  .object({ needsManualRefund: z.boolean().catch(false) })
  .catch({ needsManualRefund: false });

/** Payment row → the admin projection. `gatewayResponse` is deliberately dropped. */
const toAdminPayment = (payment: Payment): AdminPayment => ({
  method: payment.method,
  status: payment.status,
  amount: payment.amount,
  authority: payment.authority,
  refId: payment.refId,
  cardPan: payment.cardPan,
  failureReason: payment.failureReason,
  needsManualRefund: refundFlagSchema.parse(payment.gatewayResponse)
    .needsManualRefund,
  paidAt: payment.paidAt,
  createdAt: payment.createdAt,
});

/**
 * One order in full for the admin, or `null` when no order has that id. Keyed by
 * the uuid `id`, never the enumerable `order_no`. The caller (page or route) is
 * behind `requireAdmin`, so there is no owner scoping here — an admin sees every
 * order.
 */
export const getAdminOrder = async (
  orderId: string,
): Promise<AdminOrder | null> => {
  const order = await OrderDao.getById(orderId);
  if (!order) return null;

  const payments = (await PaymentDao.listByOrder(orderId)).map(toAdminPayment);
  const receipts = (await ReceiptDao.listByOrder(orderId)).map(
    ({ id, contentType, size, createdAt }) => ({
      id,
      contentType,
      size,
      createdAt,
    }),
  );
  return { ...order, payments, receipts };
};
