// `OrderDao.salesByProductSince`, the admin insights page's sales half. Needs a
// live Postgres (src/db/test-db.ts): what it proves is SQL a mocked `db`
// cannot check — the revenue rule applied through the join, the window on the
// order's own `created_at`, and money summed from the line snapshots.
//
// The orders table is shared with every other suite and with QA, so every
// assertion reads only the rows for this test's own products.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '@/db/schema/catalog';
import { orders } from '@/db/schema/orders';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

const DAY = 24 * 60 * 60_000;

describe.skipIf(!databaseReachable)('OrderDao.salesByProductSince', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** An order of `lines`, in a status, with one payment, placed `createdAt`. */
  const order = async ({
    lines,
    status = ORDER_STATUSES.PROCESSING,
    payment = PAYMENT_STATUSES.PAID,
    createdAt = new Date(),
  }: {
    lines: { product: Product; qty: number; unitPrice: number }[];
    status?: OrderStatus;
    payment?: PaymentStatus;
    createdAt?: Date;
  }) => {
    const created = await OrderDao.create(
      fx.buildOrder(await fx.user(), lines, {
        status,
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      }),
    );
    fx.remember(created.id);
    await PaymentDao.create({
      orderId: created.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: payment,
      amount: created.total,
      authority: `A-${crypto.randomUUID()}`,
      paidAt: payment === PAYMENT_STATUSES.PAID ? new Date() : null,
    });
    await testDb
      .update(orders)
      .set({ createdAt })
      .where(eq(orders.id, created.id));
    return created;
  };

  const salesOf = async (cutoff: Date, ...products: Product[]) => {
    const ids = new Set(products.map(({ id }) => id));
    const rows = await OrderDao.salesByProductSince(cutoff);
    return Object.fromEntries(
      rows
        .filter((row) => ids.has(row.productId))
        .map(({ productId, ...rest }) => [productId, rest]),
    );
  };

  it('sums units, line revenue and distinct orders per product', async () => {
    const category = await fx.category();
    const [a, b] = [await fx.product(category), await fx.product(category)];
    await order({
      lines: [
        { product: a, qty: 2, unitPrice: 120_000 },
        { product: b, qty: 1, unitPrice: 45_000 },
      ],
    });
    await order({ lines: [{ product: a, qty: 3, unitPrice: 100_000 }] });

    expect(await salesOf(new Date(Date.now() - DAY), a, b)).toEqual({
      [a.id]: { units: 5, revenue: 540_000, orders: 2 },
      [b.id]: { units: 1, revenue: 45_000, orders: 1 },
    });
  });

  it('leaves out the shipping fee and the discount: they are not a product’s', async () => {
    const product = await fx.product(await fx.category());
    const placed = await order({
      lines: [{ product, qty: 1, unitPrice: 80_000 }],
    });
    expect(placed.total).toBeGreaterThan(80_000);

    expect(await salesOf(new Date(Date.now() - DAY), product)).toEqual({
      [product.id]: { units: 1, revenue: 80_000, orders: 1 },
    });
  });

  it.each([
    ['paid', ORDER_STATUSES.PAID],
    ['processing', ORDER_STATUSES.PROCESSING],
    ['shipped', ORDER_STATUSES.SHIPPED],
    ['delivered', ORDER_STATUSES.DELIVERED],
  ])('counts a settled %s order', async (_label, status) => {
    const product = await fx.product(await fx.category());
    await order({ lines: [{ product, qty: 1, unitPrice: 10_000 }], status });
    expect(await salesOf(new Date(Date.now() - DAY), product)).toEqual({
      [product.id]: { units: 1, revenue: 10_000, orders: 1 },
    });
  });

  it.each([
    [
      'awaiting payment',
      ORDER_STATUSES.PENDING_PAYMENT,
      PAYMENT_STATUSES.PENDING,
    ],
    [
      'waiting for its receipt',
      ORDER_STATUSES.AWAITING_RECEIPT,
      PAYMENT_STATUSES.PENDING,
    ],
    ['cancelled after paying', ORDER_STATUSES.CANCELLED, PAYMENT_STATUSES.PAID],
    [
      'processing with a failed payment',
      ORDER_STATUSES.PROCESSING,
      PAYMENT_STATUSES.FAILED,
    ],
  ])('ignores an order %s', async (_label, status, payment) => {
    const product = await fx.product(await fx.category());
    await order({
      lines: [{ product, qty: 1, unitPrice: 10_000 }],
      status,
      payment,
    });
    expect(await salesOf(new Date(Date.now() - DAY), product)).toEqual({});
  });

  it('counts only orders placed on or after the cutoff', async () => {
    const product = await fx.product(await fx.category());
    const cutoff = new Date(Date.now() - 7 * DAY);
    await order({
      lines: [{ product, qty: 1, unitPrice: 10_000 }],
      createdAt: new Date(cutoff.getTime() - 1000),
    });
    await order({
      lines: [{ product, qty: 2, unitPrice: 10_000 }],
      createdAt: cutoff,
    });
    expect(await salesOf(cutoff, product)).toEqual({
      [product.id]: { units: 2, revenue: 20_000, orders: 1 },
    });
  });

  it('still reports a product deactivated since it sold', async () => {
    const product = await fx.product(await fx.category(), { isActive: false });
    await order({ lines: [{ product, qty: 1, unitPrice: 10_000 }] });
    expect(await salesOf(new Date(Date.now() - DAY), product)).toEqual({
      [product.id]: { units: 1, revenue: 10_000, orders: 1 },
    });
  });
});
