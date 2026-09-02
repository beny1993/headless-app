// The reconcile/expiry sweep — the launch-gate that gives reserved stock a
// release path. Driven through the REAL mock driver + ledger (not a hand stub) so
// the driver's amount-checked verify is exercised end to end. Ages rows by
// back-dating createdAt, the existing convention.
//
// Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, payments } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { mockDriver, mockLedger } from '@/lib/zarinpal/client';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { reconcilePayments } = await importWithDb(
  () => import('@/logic/payments/reconcile'),
);

const MIN = 60_000;

describe.skipIf(!databaseReachable)('reconcilePayments', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    await fx.cleanup();
    mockLedger.reset(); // module-level state — reset between tests
  });

  const stockOf = async (id: string) =>
    (await testDb.select().from(products).where(eq(products.id, id)))[0].stock;
  const orderStatus = async (id: string) =>
    (await testDb.select().from(orders).where(eq(orders.id, id)))[0].status;
  const paymentRow = async (id: string) =>
    (await testDb.select().from(payments).where(eq(payments.id, id)))[0];

  const ageOrder = (id: string, ms: number) =>
    testDb
      .update(orders)
      .set({ createdAt: new Date(Date.now() - ms) })
      .where(eq(orders.id, id));
  const agePayment = (id: string, ms: number) =>
    testDb
      .update(payments)
      .set({ createdAt: new Date(Date.now() - ms) })
      .where(eq(payments.id, id));

  /** A pending_payment Zarinpal order + a pending attempt, stock reserved. */
  const scenario = async ({
    qty = 2,
    initialStock = 10,
    total = 340_000,
  } = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: initialStock });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty }], { total }),
    );
    fx.remember(order.id);
    await testDb
      .update(products)
      .set({ stock: initialStock - qty })
      .where(eq(products.id, product.id));
    const payment = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: total,
      authority: `A-${crypto.randomUUID()}`,
    });
    return {
      user,
      category,
      product,
      order,
      payment,
      qty,
      initialStock,
      total,
    };
  };

  it('settles a paid-but-never-returned attempt (pass 1 verify)', async () => {
    const { order, payment, total } = await scenario();
    mockLedger.markPaid(payment.authority!, total); // paid, but no callback fired
    await agePayment(payment.id, 20 * MIN);

    const result = await reconcilePayments(mockDriver);

    expect(result.verified).toBe(1);
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    expect((await paymentRow(payment.id)).status).toBe(PAYMENT_STATUSES.PAID);
  });

  it('expires a truly-abandoned order and restocks it (pass 1 fail + pass 2 expiry)', async () => {
    const { order, payment, product, initialStock } = await scenario();
    // Ledger empty for this authority — the payment never completed.
    await agePayment(payment.id, 20 * MIN);
    await ageOrder(order.id, 2 * 60 * MIN);

    const result = await reconcilePayments(mockDriver);

    expect(result.failed).toBe(1); // pass 1 marked the attempt failed
    expect(result.expired).toBe(1); // pass 2 expired the order
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.FAILED);
    expect((await paymentRow(payment.id)).status).toBe(PAYMENT_STATUSES.FAILED);
    expect(await stockOf(product.id)).toBe(initialStock); // reserved stock returned
  });

  it('flags a double-charged second attempt on an already-paid order for refund', async () => {
    const { order, payment, product, initialStock, qty, total } =
      await scenario();
    // Attempt A pays and settles the order.
    mockLedger.markPaid(payment.authority!, total);
    await agePayment(payment.id, 20 * MIN);
    await reconcilePayments(mockDriver);
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);

    // Attempt B: a second authority that ALSO took money (a double charge).
    const b = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: total,
      authority: `B-${crypto.randomUUID()}`,
    });
    mockLedger.markPaid(b.authority!, total);
    await agePayment(b.id, 20 * MIN);

    const result = await reconcilePayments(mockDriver);

    expect(result.refundFlagged).toBe(1);
    const bRow = await paymentRow(b.id);
    expect(bRow.status).toBe(PAYMENT_STATUSES.PAID);
    expect(
      (bRow.gatewayResponse as Record<string, unknown>).needsManualRefund,
    ).toBe(true);
    // Order stays paid; stock never re-decremented by the refund path.
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    expect(await stockOf(product.id)).toBe(initialStock - qty);
  });

  it('leaves a COD order untouched (no authority in pass 1, not pending_payment in pass 2)', async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        paymentMethod: PAYMENT_METHODS.COD,
        status: ORDER_STATUSES.PROCESSING,
      }),
    );
    fx.remember(order.id);
    const cod = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      status: PAYMENT_STATUSES.PENDING,
      amount: order.total,
    });
    await ageOrder(order.id, 3 * 60 * MIN);
    await agePayment(cod.id, 60 * MIN);

    const result = await reconcilePayments(mockDriver);

    expect(result).toEqual({
      verified: 0,
      failed: 0,
      refundFlagged: 0,
      expired: 0,
    });
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PROCESSING);
    expect((await paymentRow(cod.id)).status).toBe(PAYMENT_STATUSES.PENDING);
  });

  it('does not sweep a fresh pending attempt or a fresh order', async () => {
    const { order, payment } = await scenario(); // createdAt = now, not aged

    const result = await reconcilePayments(mockDriver);

    expect(result).toEqual({
      verified: 0,
      failed: 0,
      refundFlagged: 0,
      expired: 0,
    });
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    expect((await paymentRow(payment.id)).status).toBe(
      PAYMENT_STATUSES.PENDING,
    );
  });

  it('does not expire an old order that still has a fresh (live) pending attempt', async () => {
    const { order, payment } = await scenario();
    await ageOrder(order.id, 2 * 60 * MIN); // order is old…
    // …but the attempt is fresh (< 15 min): the shopper may still be paying.

    const result = await reconcilePayments(mockDriver);

    expect(result.expired).toBe(0);
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    expect((await paymentRow(payment.id)).status).toBe(
      PAYMENT_STATUSES.PENDING,
    );
  });

  it('is re-runnable — a second sweep over settled rows changes nothing', async () => {
    const { order, payment, product, initialStock } = await scenario();
    await agePayment(payment.id, 20 * MIN);
    await ageOrder(order.id, 2 * 60 * MIN);

    const first = await reconcilePayments(mockDriver);
    const second = await reconcilePayments(mockDriver);

    expect(first.expired).toBe(1);
    expect(second).toEqual({
      verified: 0,
      failed: 0,
      refundFlagged: 0,
      expired: 0,
    });
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.FAILED);
    expect(await stockOf(product.id)).toBe(initialStock); // still restocked once
  });
});
