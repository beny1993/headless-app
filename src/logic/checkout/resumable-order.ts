// The waiting card-to-card order `/checkout` resumes: the shopper's own, still
// `awaiting_receipt`. The retry that held it lived in the page that is gone
// after a reload; this is how the one place a receipt is sent finds the order
// again. Past the receipt wait it stays resumable until the sweep cancels it
// (`expireReceiptOrders`), as the receipt route takes its screenshot until
// then: a shopper who transferred at minute 29 is not turned away at 31.
// Owner-scoped twice over: the DAO reads by the session's user id, and
// `getOwnedOrder` re-checks the owner of an id that came from the URL.
import { OrderDao } from '@/db/dao/OrderDao';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { getOwnedOrder, type OwnedOrder } from '@/logic/checkout/get-order';

/** `orderId` (the URL's) picks one; otherwise the shopper's latest. */
export const findResumableReceiptOrder = async (
  userId: string,
  orderId?: string,
): Promise<OwnedOrder | null> => {
  const id = orderId ?? (await OrderDao.latestAwaitingReceiptId(userId));
  if (!id) return null;
  const order = await getOwnedOrder(id, userId);
  return order?.status === ORDER_STATUSES.AWAITING_RECEIPT ? order : null;
};
