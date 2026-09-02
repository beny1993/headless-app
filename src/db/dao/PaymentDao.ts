// All Drizzle DB access goes through DAOs like this one. `markCodPaid` is the
// only write the state machine composes; the rest serve checkout (story 14) and
// the Zarinpal verify callback (story 15).
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import type { Executor, Tx } from '@/db/dao/OrderDao';
import { payments, type NewPayment, type Payment } from '@/db/schema/orders';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/orders/order-status';

/** What a caller supplies; the database owns `id` and both timestamps. */
export type PaymentInput = Omit<NewPayment, 'id' | 'createdAt' | 'updatedAt'>;

export class PaymentDao {
  /**
   * Inserts a payment attempt. Pass `executor` to compose it into checkout's
   * transaction alongside the order and its items. A COD order gets one row here
   * at creation with a null `authority`; a Zarinpal order gets one per attempt,
   * each with the gateway's authority id.
   */
  static async create(
    input: PaymentInput,
    executor: Executor = db,
  ): Promise<Payment> {
    const [row] = await executor.insert(payments).values(input).returning();
    return row;
  }

  /**
   * Lookup by the gateway authority id — the Zarinpal verify callback's entry
   * point. The column is unique, so this is the idempotency anchor: a second
   * callback for the same authority finds the row the first one already handled
   * rather than creating a duplicate.
   */
  static async getByAuthority(authority: string): Promise<Payment | null> {
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.authority, authority))
      .limit(1);
    return row ?? null;
  }

  /** Every payment attempt on an order, for admin and support. */
  static async listByOrder(orderId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.orderId, orderId));
  }

  /**
   * Flips an order's pending COD payment row to `paid` — the side effect of the
   * `shipped → delivered` transition for a cash-on-delivery order. Always run
   * inside the transition's transaction.
   *
   * Matches exactly the one row that should exist (method `cod`, status
   * `pending`) and throws if it updated anything other than a single row: a COD
   * order reaching `delivered` with no pending COD payment is data corruption,
   * not a no-op, and must roll the transition back rather than pass silently.
   */
  static async markCodPaid(tx: Tx, orderId: string): Promise<Payment> {
    const rows = await tx
      .update(payments)
      .set({ status: PAYMENT_STATUSES.PAID, paidAt: new Date() })
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.method, PAYMENT_METHODS.COD),
          eq(payments.status, PAYMENT_STATUSES.PENDING),
        ),
      )
      .returning();

    if (rows.length !== 1) {
      throw new Error(
        `markCodPaid expected exactly one pending COD payment for order ${orderId}, updated ${rows.length}`,
      );
    }
    return rows[0];
  }
}
