// All Drizzle DB access goes through DAOs like this one. The multi-DAO
// orchestration (a transition's CAS plus its restock / COD-payment side effects)
// lives in src/logic/orders/state-machine.ts, which composes these methods.
// Never write raw SQL — the CAS below is the query builder, not a string.
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  orderItems,
  orders,
  type NewOrder,
  type Order,
  type OrderItem,
  type OrderWithItems,
} from '@/db/schema/orders';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/orders/order-status';

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
}
