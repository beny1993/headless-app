// All Drizzle DB access goes through DAOs like this one. The multi-DAO
// orchestration (a transition's CAS plus its restock / COD-payment side effects)
// lives in src/logic/orders/state-machine.ts, which composes these methods.
// Never write raw SQL — the CAS below is the query builder, not a string.
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  orderItems,
  orders,
  payments,
  type NewOrder,
  type Order,
  type OrderItem,
  type OrderWithItems,
} from '@/db/schema/orders';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';

/**
 * One row of a customer's order history — the summary the account orders tab
 * lists (newest first). It carries no payment rows at all, so no gateway secret
 * can reach it; the detail view (owner-scoped `getOwnedOrder`) is where a single
 * order's items and safe payment status are read.
 */
export type OrderSummaryRow = {
  id: string;
  orderNo: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  total: number;
  createdAt: Date;
  /** Distinct line items on the order — the design's «{n} قلم». */
  itemCount: number;
};

/**
 * One row of the admin orders list — every order in the store (not owner-scoped),
 * with the line-item count and a paid flag. Carries no payment rows: `isPaid` is
 * a subquery boolean, so no gateway secret rides along and a multi-attempt
 * Zarinpal order does not multiply into several list rows.
 */
export type AdminOrderRow = {
  id: string;
  orderNo: number;
  /** The delivery recipient snapshot — what the admin list shows as «مشتری». */
  recipientName: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  total: number;
  createdAt: Date;
  itemCount: number;
  /** Whether any payment attempt on the order has settled (`status = paid`). */
  isPaid: boolean;
};

/**
 * The order statuses that represent a booked sale — the first half of the
 * revenue definition. The second half (an actually-settled payment) is
 * `hasPaidPayment` below; an order counts as revenue only when BOTH hold, so a
 * COD order still pending at `processing`/`shipped` is excluded (its cash is
 * collected at delivery) and a paid order later `cancelled` is excluded (the
 * money is being refunded). See `revenueSummary`.
 */
const REVENUE_ORDER_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.PAID,
  ORDER_STATUSES.PROCESSING,
  ORDER_STATUSES.SHIPPED,
  ORDER_STATUSES.DELIVERED,
];

/**
 * A correlated `EXISTS (a settled payment for this order)`. Parameterized `sql`
 * with interpolated identifiers and a bound status value — not a raw string — so
 * it obeys the DAO's no-raw-SQL rule while expressing what a join cannot without
 * multiplying rows. Used both as the list's `isPaid` flag and as half the revenue
 * predicate.
 */
const hasPaidPayment = sql<boolean>`exists (select 1 from ${payments} where ${payments.orderId} = ${orders.id} and ${payments.status} = ${PAYMENT_STATUSES.PAID})`;

/** The full revenue predicate: a booked status AND a settled payment. */
const isRevenueOrder = () =>
  and(inArray(orders.status, REVENUE_ORDER_STATUSES), hasPaidPayment);

/**
 * A transaction on one connection of the pool. It carries `rollback()`, which
 * the pool does not — so a parameter typed `Tx` structurally rejects the bare
 * `db`. The status CAS and its side effects must commit together, so the methods
 * that perform them (`casStatus`, `markCodPaid`, `transitionOrder`) take a `Tx`,
 * never an `Executor`: passing the pool there is a compile error, not a silent
 * run of each statement in its own autocommit.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whatever a write can run on: the pool, or a transaction. Checkout (story 14)
 * composes several writes in one transaction, but each is also correct on its
 * own connection — so the writes that don't *require* a shared transaction
 * (`create`, `PaymentDao.create`, `decrementStock`, `restock`, reads) take this
 * wider type. Shared from here so the DAOs and the state machine speak one type.
 */
export type Executor = typeof db | Tx;

/** One line of an order at creation time — the snapshot the item will keep. */
export type OrderItemInput = {
  productId: string;
  title: string;
  sku: string;
  /** Integer Toman. */
  unitPrice: number;
  qty: number;
};

/**
 * What a caller supplies to create an order. The database owns `id`, the
 * `order_no` serial and both timestamps; the caller owns every snapshot, because
 * snapshotting is the point — the order copies the price, province and code that
 * were true at checkout so no later edit can rewrite it.
 */
export type OrderInput = Omit<
  NewOrder,
  'id' | 'orderNo' | 'createdAt' | 'updatedAt'
> & { items: OrderItemInput[] };

export class OrderDao {
  /**
   * Inserts an order and its line items atomically. Pass a transaction to
   * compose this into a larger one (checkout also decrements stock and inserts
   * the payment row in the same `tx`); omit it and the two inserts run in their
   * own transaction so a standalone create can never leave an order with no
   * items. The param is `Tx`, not `Executor`: composing on the bare pool would
   * defeat the atomicity, so it cannot type-check.
   */
  static async create(
    { items, ...order }: OrderInput,
    tx?: Tx,
  ): Promise<OrderWithItems> {
    const run = async (tx: Tx): Promise<OrderWithItems> => {
      const [created] = await tx.insert(orders).values(order).returning();
      const createdItems = await tx
        .insert(orderItems)
        .values(items.map((item) => ({ ...item, orderId: created.id })))
        .returning();
      return { ...created, items: createdItems };
    };

    return tx ? run(tx) : db.transaction(run);
  }

  /** Order display / admin read: the order with its snapshotted line items. */
  static async getById(id: string): Promise<OrderWithItems | null> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    if (!order) return null;
    return { ...order, items: await OrderDao.getItems(db, id) };
  }

  /**
   * The order a `userId` created under `idempotencyKey`, or `null`. Checkout's
   * idempotency lookup: the fast path a retry hits before doing any work, and the
   * re-fetch after a losing concurrent insert trips the partial unique index. The
   * `(user_id, idempotency_key)` pair is unique, so this returns at most one.
   */
  static async getByUserAndIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<OrderWithItems | null> {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!order) return null;
    return { ...order, items: await OrderDao.getItems(db, order.id) };
  }

  /** Lookup by the human-readable order number — the id support is handed. */
  static async getByOrderNo(orderNo: number): Promise<OrderWithItems | null> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);
    if (!order) return null;
    return { ...order, items: await OrderDao.getItems(db, order.id) };
  }

  /**
   * The compare-and-set at the heart of the state machine:
   * `UPDATE orders SET status = to WHERE id = ? AND status = from RETURNING *`.
   *
   * Returns the updated row, or `null` when no row matched — which means the
   * order was not in `from` (a lost race, or a stale caller). The state machine
   * turns that `null` into an `InvalidTransitionError`. Always run inside the
   * transaction that also performs the transition's side effects, so the status
   * change and the restock / payment flip commit together or not at all.
   */
  static async casStatus(
    tx: Tx,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<Order | null> {
    const [row] = await tx
      .update(orders)
      .set({ status: to })
      .where(and(eq(orders.id, id), eq(orders.status, from)))
      .returning();
    return row ?? null;
  }

  /**
   * How many `pending_payment` orders `userId` currently holds — the input to
   * checkout's interim open-order cap. Only `pending_payment` counts: it is the
   * one state whose reserved stock has no release path until the Zarinpal
   * expiry/reconcile job exists, so it is the only state the cap must bound. COD
   * enters at `processing` (a releasable state) and is deliberately excluded.
   */
  static async countOpenForUser(userId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.status, ORDER_STATUSES.PENDING_PAYMENT),
        ),
      );
    return row.value;
  }

  /**
   * How many orders `userId` created since `since` — the input to checkout's
   * rolling creation cap.
   *
   * No status filter, deliberately: a cancelled or failed order still cost the
   * shop a row, a stock movement and an SMS to every admin, so letting it stop
   * counting would hand an attacker a reset button (create to the cap, cancel
   * everything, go again). Only the clock lets the count fall.
   */
  static async countCreatedSince(userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, since)));
    return row.value;
  }

  /**
   * The current status of one order, read inside the caller's transaction. The
   * Zarinpal verify path uses it after a lost `pending_payment → paid` CAS to
   * decide *why* the order moved on — already `paid` (idempotent replay) versus
   * `failed`/`cancelled` (money taken for an order that expired → manual refund).
   * Takes a `Tx` so that read sees the same committed state the failed CAS did.
   */
  static async getStatus(tx: Tx, id: string): Promise<OrderStatus | null> {
    const [row] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    return row?.status ?? null;
  }

  /** Serialize payment-attempt insertion and expiry on their shared order row. */
  static async lockStatus(tx: Tx, id: string): Promise<OrderStatus | null> {
    const [row] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
      .for('update');
    return row?.status ?? null;
  }

  /**
   * Every `pending_payment` order created before `cutoff` — the reconcile job's
   * pass-2 expiry worklist. The reserved stock of these orders has no release
   * path until they are transitioned to `failed` (which restocks), so this is the
   * query that finds the abandoned ones. The caller still checks each order for a
   * live (pending/paid) payment before expiring it.
   */
  static async listExpiredPendingPayment(cutoff: Date): Promise<Order[]> {
    return db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, ORDER_STATUSES.PENDING_PAYMENT),
          lt(orders.createdAt, cutoff),
        ),
      );
  }

  /**
   * A customer's order history: their orders, newest first, each with its line-
   * item count — one grouped query, no N+1. Owner-scoped by `userId` from the
   * session (never the URL). `groupBy(orders.id)` is sound because `id` is the PK,
   * so every selected order column is functionally dependent on it.
   */
  static async listByUser(userId: string): Promise<OrderSummaryRow[]> {
    return db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        total: orders.total,
        createdAt: orders.createdAt,
        itemCount: count(orderItems.id),
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(eq(orders.userId, userId))
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt), desc(orders.orderNo));
  }

  /** An order's line items, oldest first. Used for display and for restock. */
  static async getItems(
    executor: Executor,
    orderId: string,
  ): Promise<OrderItem[]> {
    return executor
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  }

  /**
   * One page of the admin orders list: every order in the store, newest first,
   * each with its line-item count and a settled-payment flag, optionally filtered
   * to one status, plus the size of that whole set for the pager. Store-wide by
   * design — unlike `listByUser`, it is not owner-scoped, because the admin can
   * and must see everyone's orders; the `requireAdmin` guard on the page is what
   * authorizes it. `groupBy(orders.id)` is sound (the PK), so `isPaid` (a
   * per-order correlated subquery) and every order column are functionally
   * dependent on the group key. The count reads `orders` alone: joining the items
   * would not change how many orders there are.
   */
  static async pageForAdmin({
    status,
    page = 1,
    limit = ADMIN_PAGE_SIZE,
  }: {
    status?: OrderStatus;
    /** One-based. */
    page?: number;
    limit?: number;
  } = {}): Promise<{ items: AdminOrderRow[]; total: number }> {
    const where = status ? eq(orders.status, status) : undefined;
    const pageQuery = db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        recipientName: orders.recipientName,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        total: orders.total,
        createdAt: orders.createdAt,
        itemCount: count(orderItems.id),
        isPaid: hasPaidPayment,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(where)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt), desc(orders.orderNo))
      .limit(limit)
      .offset((page - 1) * limit);

    const [items, [counted]] = await Promise.all([
      pageQuery,
      db.select({ value: count() }).from(orders).where(where),
    ]);
    return { items, total: counted.value };
  }

  /**
   * The dashboard's all-time revenue and order count: `sum(total)` and `count`
   * over the revenue set (a booked status AND a settled payment). `sum` of a
   * `bigint` comes back as a numeric string; `Number` is exact here because a
   * store's grand total in integer Toman stays far below 2^53.
   * ponytail: if a store's lifetime revenue ever approaches 2^53 Toman
   * (~9e15 ≈ 9 quadrillion), sum in `bigint`; nothing here is close.
   */
  static async revenueSummary(): Promise<{
    revenue: number;
    orderCount: number;
  }> {
    const [row] = await db
      .select({
        revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
        orderCount: count(),
      })
      .from(orders)
      .where(isRevenueOrder());
    return { revenue: Number(row.revenue), orderCount: row.orderCount };
  }

  /**
   * Every revenue order created on or after `cutoff`, as `{ createdAt, total }` —
   * the raw rows the dashboard buckets by Jalali month in JS (Postgres has no
   * Persian calendar). The window is bounded by the caller's cutoff so this never
   * scans the whole table.
   */
  static async revenueOrdersSince(
    cutoff: Date,
  ): Promise<{ createdAt: Date; total: number }[]> {
    return db
      .select({ createdAt: orders.createdAt, total: orders.total })
      .from(orders)
      .where(and(isRevenueOrder(), gte(orders.createdAt, cutoff)));
  }

  /** How many orders are in one status — the dashboard's «awaiting action» tile. */
  static async countByStatus(status: OrderStatus): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(orders)
      .where(eq(orders.status, status));
    return row.value;
  }
}
