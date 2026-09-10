// All Drizzle DB access goes through DAOs like this one. `markCodPaid` is the
// only write the state machine composes; the rest serve checkout (story 14) and
// the Zarinpal verify callback (story 15).
import { and, asc, eq, isNotNull, lt, ne } from 'drizzle-orm';
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

  /**
   * Every payment attempt on an order, oldest first — for admin, support, and
   * the customer-facing `payments[]` of GET /api/orders/:id. Deterministic
   * ordering matters once Zarinpal retries create more than one row per order
   * (story 15): without it the read flips between requests.
   */
  static async listByOrder(
    orderId: string,
    executor: Executor = db,
  ): Promise<Payment[]> {
    return executor
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(asc(payments.createdAt), asc(payments.id));
  }

  /**
   * Every pending Zarinpal attempt whose authority is older than `cutoff` — the
   * reconcile job's pass-1 worklist. `authority IS NOT NULL` excludes COD rows
   * (they have no gateway to verify), and the age cutoff keeps a fresh attempt a
   * shopper may still be completing out of the sweep.
   */
  static async listPendingWithAuthorityOlderThan(
    cutoff: Date,
  ): Promise<Payment[]> {
    return db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.status, PAYMENT_STATUSES.PENDING),
          isNotNull(payments.authority),
          lt(payments.createdAt, cutoff),
        ),
      );
  }

  /**
   * Marks a Zarinpal attempt `paid` — the verify path's ONLY writer of
   * `status = paid` / `paidAt`. Always run inside the same transaction as the
   * order's `pending_payment → paid` CAS so the two commit together (a lost
   * order CAS rolls this write back).
   *
   * The CAS is `WHERE status <> 'paid'`, deliberately NOT `= 'pending'`: a row
   * this reconcile once marked `failed` can still be genuinely paid by a later
   * verify-OK (Zarinpal took the money), and `= 'pending'` would silently drop
   * that. Idempotent — a second verify on an already-`paid` row matches nothing
   * and returns `null`.
   */
  static async markPaid(
    tx: Tx,
    id: string,
    fields: {
      refId: string;
      cardPan: string | null;
      gatewayResponse: unknown;
      paidAt: Date;
    },
  ): Promise<Payment | null> {
    const [row] = await tx
      .update(payments)
      .set({
        status: PAYMENT_STATUSES.PAID,
        refId: fields.refId,
        cardPan: fields.cardPan,
        gatewayResponse: fields.gatewayResponse,
        paidAt: fields.paidAt,
      })
      .where(
        and(eq(payments.id, id), ne(payments.status, PAYMENT_STATUSES.PAID)),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Marks a pending attempt `failed` (a NOK callback or a rejected verify). The
   * CAS is `WHERE status = 'pending'`: it never un-pays a `paid` row and never
   * re-fails a `failed` one, so a replayed failure is a no-op (`null`). No side
   * effects, so it takes any `Executor` rather than forcing a transaction.
   */
  static async markFailed(
    executor: Executor,
    id: string,
    fields: { failureReason: string; gatewayResponse: unknown },
  ): Promise<Payment | null> {
    const [row] = await executor
      .update(payments)
      .set({
        status: PAYMENT_STATUSES.FAILED,
        failureReason: fields.failureReason,
        gatewayResponse: fields.gatewayResponse,
      })
      .where(
        and(eq(payments.id, id), eq(payments.status, PAYMENT_STATUSES.PENDING)),
      )
      .returning();
    return row ?? null;
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
