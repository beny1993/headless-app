// All Drizzle DB access goes through DAOs like this one. The multi-DAO
// orchestration (a transition's CAS plus its restock / COD-payment side effects)
// lives in src/logic/orders/state-machine.ts, which composes these methods.
// Never write raw SQL — the CAS below is the query builder, not a string.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  orderItems,
  orders,
  type NewOrder,
  type Order,
  type OrderItem,
  type OrderWithItems,
} from '@/db/schema/orders';
import type { OrderStatus } from '@/lib/orders/order-status';

/**
 * Whatever a write can run on: the pool, or a transaction on one connection of
 * it. Checkout (story 14) reserves stock, inserts the order and its items, and
 * inserts the payment row in one transaction, so every method it composes takes
 * one of these. Shared from here so `PaymentDao`, `ProductDao` and the state
 * machine speak the same type.
 */
export type Executor =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
   * Inserts an order and its line items atomically. Pass `executor` to compose
   * this into a larger transaction (checkout also decrements stock and inserts
   * the payment row in the same one); omit it and the two inserts run in their
   * own transaction so a standalone create can never leave an order with no
   * items.
   */
  static async create(
    { items, ...order }: OrderInput,
    executor?: Executor,
  ): Promise<OrderWithItems> {
    const run = async (tx: Executor): Promise<OrderWithItems> => {
      const [created] = await tx.insert(orders).values(order).returning();
      const createdItems = await tx
        .insert(orderItems)
        .values(items.map((item) => ({ ...item, orderId: created.id })))
        .returning();
      return { ...created, items: createdItems };
    };

    return executor ? run(executor) : db.transaction(run);
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
    executor: Executor,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<Order | null> {
    const [row] = await executor
      .update(orders)
      .set({ status: to })
      .where(and(eq(orders.id, id), eq(orders.status, from)))
      .returning();
    return row ?? null;
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
