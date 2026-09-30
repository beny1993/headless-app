// Card-to-card payment receipts: metadata rows over objects in storage. The
// multi-DAO sequence around them — lock the order, cap, insert, accept, alert —
// lives in src/logic/orders/receipts.ts; this only reads and writes the table.
import { and, asc, eq } from 'drizzle-orm';
import { db, type Executor, type Tx } from '@/db';
import {
  orders,
  paymentReceipts,
  type PaymentReceipt,
} from '@/db/schema/orders';

export class ReceiptDao {
  /** An order's receipts, oldest first — the order they arrived in. */
  static async listByOrder(
    orderId: string,
    executor: Executor = db,
  ): Promise<PaymentReceipt[]> {
    return executor
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.orderId, orderId))
      .orderBy(asc(paymentReceipts.createdAt), asc(paymentReceipts.id));
  }

  /** How many receipts an order holds. */
  static async countByOrder(orderId: string): Promise<number> {
    return db.$count(paymentReceipts, eq(paymentReceipts.orderId, orderId));
  }

  /**
   * Receipt `receiptId` of order `orderId`, only when `userId` owns the order;
   * else `null` — so another customer's receipt, a receipt of another order
   * and one that never existed are one and the same `null`. The owner is
   * required: this read never widens into the admin one.
   */
  static async getOwnedForOrder(
    receiptId: string,
    orderId: string,
    userId: string,
  ): Promise<PaymentReceipt | null> {
    const [row] = await db
      .select({ receipt: paymentReceipts })
      .from(paymentReceipts)
      .innerJoin(orders, eq(orders.id, paymentReceipts.orderId))
      .where(
        and(
          eq(paymentReceipts.id, receiptId),
          eq(paymentReceipts.orderId, orderId),
          eq(orders.userId, userId),
        ),
      )
      .limit(1);
    return row?.receipt ?? null;
  }

  /**
   * Receipt `receiptId` of order `orderId`, whoever owns the order — for an
   * admin, whom `requireAdmin` has already authorized. Still only by its own
   * order: a receipt asked for under another order is `null`.
   */
  static async getForOrderAsAdmin(
    receiptId: string,
    orderId: string,
  ): Promise<PaymentReceipt | null> {
    const [row] = await db
      .select()
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.id, receiptId),
          eq(paymentReceipts.orderId, orderId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Records a receipt while the order holds fewer than `limit`, else `null`.
   * The caller holds the order's row lock (`OrderDao.lockForReceipt`), which
   * is what makes the count and the insert one step: two uploads racing for
   * the last slot queue on that lock, and the second one counts the first.
   */
  static async insertUnderCap(
    tx: Tx,
    orderId: string,
    receipt: { objectKey: string; contentType: string; size: number },
    limit: number,
  ): Promise<PaymentReceipt | null> {
    const held = await tx.$count(
      paymentReceipts,
      eq(paymentReceipts.orderId, orderId),
    );
    if (held >= limit) return null;
    const [row] = await tx
      .insert(paymentReceipts)
      .values({ orderId, ...receipt })
      .returning();
    return row;
  }
}
