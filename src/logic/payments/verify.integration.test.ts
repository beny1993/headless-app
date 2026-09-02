// The settle path — the money core. Every assertion here would fail if its
// invariant broke: exactly-one-paid under a replay/race, the same-tx coupling of
// the order CAS and the payment write, and the manual-refund handling of a late
// success on an order that already moved on.
//
// Needs a live database — see src/db/test-db.ts. Verify is driven by an injected
// stub ZarinpalClient so ok/fail/alreadyVerified/amount-mismatch are precise.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, payments, type Payment } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import type { ZarinpalClient } from '@/lib/zarinpal/client';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const verify = await importWithDb(() => import('@/logic/payments/verify'));

/** A stub gateway: verify always succeeds unless overridden. */
const stubClient = (over: Partial<ZarinpalClient> = {}): ZarinpalClient => ({
  requestPayment: async () => ({ authority: 'unused', redirectUrl: 'unused' }),
  verifyPayment: async () => ({
    ok: true,
    refId: 'ref-100',
    cardPan: '502229******5995',
    alreadyVerified: false,
  }),
  ...over,
});

const failClient = (code: number, message: string): ZarinpalClient =>
  stubClient({ verifyPayment: async () => ({ ok: false, code, message }) });

describe.skipIf(!databaseReachable)('settle (verify.ts)', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    await fx.cleanup();
    vi.restoreAllMocks();
  });

  /**
   * A `pending_payment` Zarinpal order with a pending attempt, and the product
   * stock decremented by the ordered qty to mirror the checkout reservation — so
   * a restock on failure returns the stock to `initialStock`.
   */
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
    // Mirror checkout's reservation (OrderDao.create does not touch stock).
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
    return { user, product, order, payment, qty, initialStock };
  };

  const orderStatus = async (id: string) =>
    (await testDb.select().from(orders).where(eq(orders.id, id)))[0].status;
  const paymentRow = async (id: string): Promise<Payment> =>
    (await testDb.select().from(payments).where(eq(payments.id, id)))[0];
  const stockOf = async (id: string) =>
    (await testDb.select().from(products).where(eq(products.id, id)))[0].stock;

  it('verify OK settles the order paid and records the ref, no refund flag', async () => {
    const { order, payment } = await scenario();

    const outcome = await verify.settlePendingPayment(payment, stubClient());

    expect(outcome).toBe('paid');
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    const row = await paymentRow(payment.id);
    expect(row.status).toBe(PAYMENT_STATUSES.PAID);
    expect(row.refId).toBe('ref-100');
    expect(row.paidAt).not.toBeNull();
    expect(
      (row.gatewayResponse as Record<string, unknown>).needsManualRefund,
    ).toBeUndefined();
  });

  it('a replayed OK is an idempotent no-op — one paid row, still paid once', async () => {
    const { order, payment } = await scenario();

    const first = await verify.settlePendingPayment(payment, stubClient());
    // Re-read: the row is now paid, exactly as a second callback would see it.
    const reread = await paymentRow(payment.id);
    const second = await verify.settlePendingPayment(reread, stubClient());

    expect(first).toBe('paid');
    expect(second).toBe('already_paid');
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
  });

  it('two concurrent verifies produce exactly one paid — no double pay', async () => {
    const { order, payment, product, initialStock, qty } = await scenario();

    const outcomes = await Promise.all([
      verify.settlePendingPayment(payment, stubClient()),
      verify.settlePendingPayment(payment, stubClient()),
    ]);

    expect(outcomes.filter((o) => o === 'paid')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_paid')).toHaveLength(1);
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    // The single paid row carries no manual-refund flag (the loser never
    // overwrote the winner — the `ne(status,'paid')` guard held).
    const row = await paymentRow(payment.id);
    expect(
      (row.gatewayResponse as Record<string, unknown>).needsManualRefund,
    ).toBeUndefined();
    // Settling never touches stock — no double decrement.
    expect(await stockOf(product.id)).toBe(initialStock - qty);
  });

  it('verify failure marks the attempt failed and leaves the order retryable', async () => {
    const { order, payment } = await scenario();

    const outcome = await verify.settlePendingPayment(
      payment,
      failClient(-33, 'amount mismatch'),
    );

    expect(outcome).toBe('failed');
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    const row = await paymentRow(payment.id);
    expect(row.status).toBe(PAYMENT_STATUSES.FAILED);
    expect(row.failureReason).toContain('-33');
  });

  it('NOK callback fails the attempt, order stays pending_payment (retry-pay)', async () => {
    const { order, payment } = await scenario();

    const outcome = await verify.handleCallback(payment, 'NOK', stubClient());

    expect(outcome).toBe('failed');
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    expect((await paymentRow(payment.id)).status).toBe(PAYMENT_STATUSES.FAILED);
  });

  it('NOK on an already-paid order does NOT un-pay it (fast path + markFailed CAS)', async () => {
    const { order, payment } = await scenario();
    await verify.settlePendingPayment(payment, stubClient()); // now paid

    const reread = await paymentRow(payment.id);
    const outcome = await verify.handleCallback(reread, 'NOK', stubClient());

    expect(outcome).toBe('already_paid');
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    expect((await paymentRow(payment.id)).status).toBe(PAYMENT_STATUSES.PAID);
  });

  it('late verify-OK on an EXPIRED order keeps the money paid + flags manual refund, no restock', async () => {
    // This is the markPaid `WHERE status <> paid` mutation test: flip that CAS to
    // `= pending` and this fails (the failed row never flips, the money is lost).
    const { order, payment, product, initialStock } = await scenario();

    // Simulate the reconcile expiry: the attempt failed, then the order expired
    // to `failed` (which restocks the reserved qty).
    await testDb
      .update(payments)
      .set({ status: PAYMENT_STATUSES.FAILED })
      .where(eq(payments.id, payment.id));
    await testDb.transaction((tx) =>
      OrderDao.casStatus(
        tx,
        order.id,
        ORDER_STATUSES.PENDING_PAYMENT,
        ORDER_STATUSES.FAILED,
      ),
    );
    await testDb
      .update(products)
      .set({ stock: initialStock }) // restored by the (simulated) expiry restock
      .where(eq(products.id, product.id));

    // Now the genuinely-late gateway success arrives (money WAS taken).
    const reread = await paymentRow(payment.id);
    const outcome = await verify.settlePendingPayment(reread, stubClient());

    expect(outcome).toBe('refund_flagged');
    const row = await paymentRow(payment.id);
    expect(row.status).toBe(PAYMENT_STATUSES.PAID); // money kept, not lost
    const gw = row.gatewayResponse as Record<string, unknown>;
    expect(gw.needsManualRefund).toBe(true);
    expect(gw.orderStatus).toBe(ORDER_STATUSES.FAILED);
    // Order stays failed; stock is NOT re-decremented (restocked exactly once).
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.FAILED);
    expect(await stockOf(product.id)).toBe(initialStock);
  });

  it('couples the order CAS and payment write in ONE tx — a markPaid throw rolls both back', async () => {
    const { order, payment } = await scenario();
    // Force markPaid to throw AFTER transitionOrder has won the CAS inside the tx.
    vi.spyOn(PaymentDao, 'markPaid').mockRejectedValueOnce(
      new Error('boom after order CAS won'),
    );

    await expect(
      verify.settlePendingPayment(payment, stubClient()),
    ).rejects.toThrow('boom');

    // Both must have rolled back: order still pending_payment, payment still pending.
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    expect((await paymentRow(payment.id)).status).toBe(
      PAYMENT_STATUSES.PENDING,
    );
  });
});
