// A card-to-card order's transfer receipts: who may upload one, what the first
// one does, and who may read one back. Storage (the bytes), two DAOs (the
// order, the receipt rows) and the state machine meet here, so it lives in
// src/logic/, never in the route.
//
// The flow Benyamin decided (2026-09-29): the shopper's FIRST receipt accepts
// the order — `awaiting_receipt → processing`, inside the insert's transaction,
// under the order's row lock — and the admins get the new-order SMS at that
// moment. The admin checks the receipt afterwards: ships, or cancels with a
// reason. Later receipts (a second transfer) are kept and change nothing.
//
// Privacy: the bytes go to `receipts/<uuid>.<ext>`, a key no public URL serves;
// only `readReceipt` reads them, for the order's owner or an admin. A failure
// reports at most the order id — never the user, the bytes or a file name.
import * as Sentry from '@sentry/nextjs';
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { ReceiptDao } from '@/db/dao/ReceiptDao';
import type { PaymentReceipt } from '@/db/schema/orders';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { acceptsReceipts, MAX_RECEIPTS_PER_ORDER } from '@/lib/orders/receipt';
import {
  getStorageDriver,
  ReceiptExposedError,
  type StorageDriver,
} from '@/lib/storage';
import {
  contentTypeOfKey,
  objectKeyFor,
  RECEIPT_KEY_PREFIX,
  type AcceptedImageType,
} from '@/lib/storage/image-upload';
import { notifyAdminsOfNewOrder } from '@/logic/orders/notify-new-order';
import { transitionOrder } from '@/logic/orders/state-machine';

/**
 * Whether `userId` may upload a receipt to order `orderId` right now — run by
 * the route BEFORE the body is read, so a refused upload is never buffered.
 * `not_found` is both a missing order and someone else's: one answer, so the
 * route cannot tell a stranger which orders exist. `uploadReceipt` checks the
 * owner, the method and the status again under the order's lock, and the cap
 * as it inserts: this is the fast path, not the gate.
 */
export const receiptUploadGate = async (
  orderId: string,
  userId: string,
): Promise<{
  outcome: 'ok' | 'not_found' | 'not_accepting' | 'cap_reached';
}> => {
  const order = await OrderDao.getById(orderId);
  if (!order || order.userId !== userId) return { outcome: 'not_found' };
  if (!acceptsReceipts(order)) return { outcome: 'not_accepting' };
  if ((await ReceiptDao.countByOrder(orderId)) >= MAX_RECEIPTS_PER_ORDER) {
    return { outcome: 'cap_reached' };
  }
  return { outcome: 'ok' };
};

type UploadResult =
  | { outcome: 'ok'; receipt: PaymentReceipt; accepted: boolean }
  /** No such order for this user — missing or someone else's, one answer. */
  | { outcome: 'not_found' }
  /** The order no longer takes receipts (moved on since the gate). */
  | { outcome: 'not_accepting' }
  | { outcome: 'cap_reached' }
  /**
   * Storage could not keep the receipt private: refused, with no row recorded.
   * The driver deletes the object when the bucket allows it, and the server log
   * says whether it did.
   */
  | { outcome: 'exposed' };

/**
 * Takes a file nothing will ever reference back out. A failure is reported —
 * an orphaned receipt is someone's bank details sitting in storage — but never
 * thrown: the answer the shopper gets does not depend on it. Reported by the
 * order and the error's code alone: a filesystem error's message names the
 * file, and the file's name is the receipt's key.
 */
const deleteQuietly = (driver: StorageDriver, key: string, orderId: string) =>
  driver.delete(key).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).name;
    console.warn(
      `[receipts] removing a refused receipt of order ${orderId} failed: ${code}`,
    );
    Sentry.captureMessage('[receipts] removing a refused receipt failed', {
      extra: { orderId, code },
    });
  });

/**
 * Store `bytes` (already sniffed as `type`) as a receipt of `userId`'s order
 * `orderId` — `userId` from the session, never the request.
 *
 * The object is written first, then — in one transaction, under the order's
 * row lock, taken only if the order is `userId`'s — the order is re-checked,
 * the receipt recorded under the cap and,
 * if the order was still waiting for its first receipt, accepted into
 * `processing`. Two first receipts racing queue on that lock: the first
 * accepts, the second finds `processing` and is simply kept. Any refusal takes
 * the object back out. After the commit, an acceptance tells the admins —
 * un-awaited: `notifyAdminsOfNewOrder` never rejects and never delays this.
 */
export const uploadReceipt = async (
  orderId: string,
  userId: string,
  bytes: Uint8Array,
  type: AcceptedImageType,
): Promise<UploadResult> => {
  const driver = getStorageDriver();
  const key = objectKeyFor(type, RECEIPT_KEY_PREFIX);

  try {
    await driver.put(key, bytes, type);
  } catch (error) {
    if (error instanceof ReceiptExposedError) return { outcome: 'exposed' };
    throw error;
  }

  let result: UploadResult;
  try {
    result = await db.transaction(async (tx): Promise<UploadResult> => {
      const order = await OrderDao.lockForReceipt(tx, orderId, userId);
      if (!order) return { outcome: 'not_found' };
      if (!acceptsReceipts(order)) return { outcome: 'not_accepting' };
      const receipt = await ReceiptDao.insertUnderCap(
        tx,
        orderId,
        { objectKey: key, contentType: type, size: bytes.byteLength },
        MAX_RECEIPTS_PER_ORDER,
      );
      if (!receipt) return { outcome: 'cap_reached' };

      const accepted = order.status === ORDER_STATUSES.AWAITING_RECEIPT;
      if (accepted) {
        await transitionOrder(
          tx,
          orderId,
          ORDER_STATUSES.AWAITING_RECEIPT,
          ORDER_STATUSES.PROCESSING,
        );
      }
      return { outcome: 'ok', receipt, accepted };
    });
  } catch (error) {
    await deleteQuietly(driver, key, orderId);
    throw error;
  }

  if (result.outcome !== 'ok') {
    await deleteQuietly(driver, key, orderId);
    return result;
  }
  if (result.accepted) void notifyAdminsOfNewOrder(orderId);
  return result;
};

/**
 * The bytes of receipt `receiptId` of order `orderId`, with the type its key
 * names (minted from the sniffed bytes; the row's `content_type` column is
 * never served) — for the order's owner (`{ userId }`, from the session) or
 * for an admin. `null` for a missing receipt, another customer's, one filed
 * under a different order, and one whose object is gone: the routes answer
 * all four with the same 404.
 */
export const readReceipt = async (
  orderId: string,
  receiptId: string,
  scope: { userId: string } | 'admin',
): Promise<{ contentType: string; bytes: Uint8Array } | null> => {
  const receipt =
    scope === 'admin'
      ? await ReceiptDao.getForOrderAsAdmin(receiptId, orderId)
      : await ReceiptDao.getOwnedForOrder(receiptId, orderId, scope.userId);
  const contentType = receipt && contentTypeOfKey(receipt.objectKey);
  if (!receipt || !contentType) return null;
  const bytes = await getStorageDriver().get(receipt.objectKey);
  return bytes && { contentType, bytes };
};
