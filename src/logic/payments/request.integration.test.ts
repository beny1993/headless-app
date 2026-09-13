// Starting a payment: owner-scoping (IDOR), the order-state/method gates, and the
// pending row keyed by the gateway authority. Uses the default mock driver via
// getZarinpalClient (provider defaults to `mock`), so this also proves the seam
// wires end to end.
//
// Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, payments } from '@/db/schema/orders';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { mockDriver } from '@/lib/zarinpal/client';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { reconcilePayments } = await importWithDb(
  () => import('@/logic/payments/reconcile'),
);
const request = await importWithDb(() => import('@/logic/payments/request'));

describe.skipIf(!databaseReachable)('requestZarinpalPayment', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
  });

  const zarinpalOrder = async (overrides = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        total: 340_000,
        ...overrides,
      }),
    );
    fx.remember(order.id);
    return { user, order };
  };

  const paymentsFor = async (orderId: string) =>
    testDb.select().from(payments).where(eq(payments.orderId, orderId));

  it('creates a pending attempt keyed by the authority and returns a redirect', async () => {
    const { user, order } = await zarinpalOrder();

    const { redirectUrl } = await request.requestZarinpalPayment(
      user.id,
      order.id,
    );

    expect(redirectUrl).toContain('/api/payments/zarinpal/mock-gateway');
    const rows = await paymentsFor(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: 340_000,
    });
    expect(rows[0].authority).toBeTruthy();
  });

  it('does not return a payable URL when expiry wins during the gateway request', async () => {
    const { user, order } = await zarinpalOrder();
    await testDb
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60_000) })
      .where(eq(orders.id, order.id));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = mockDriver.requestPayment.bind(mockDriver);
    vi.spyOn(mockDriver, 'requestPayment').mockImplementation(async (input) => {
      entered.resolve();
      await release.promise;
      return original(input);
    });
    const pending = request.requestZarinpalPayment(user.id, order.id);
    const outcome = pending.then(
      () => 'payable',
      (error: unknown) => error,
    );
    await entered.promise;
    try {
      const sweep = await reconcilePayments(mockDriver);
      expect(sweep.expired).toBeGreaterThanOrEqual(1);
    } finally {
      release.resolve();
    }
    expect(await outcome).toMatchObject({
      name: 'PaymentRequestError',
      status: 422,
    });
    expect(await paymentsFor(order.id)).toHaveLength(0);
  });

  it('404s another user’s order without leaking that it exists (IDOR)', async () => {
    const { order } = await zarinpalOrder();
    const attacker = await fx.user();

    await expect(
      request.requestZarinpalPayment(attacker.id, order.id),
    ).rejects.toMatchObject({ name: 'PaymentRequestError', status: 404 });
    // Nothing was created for the attacker's attempt.
    expect(await paymentsFor(order.id)).toHaveLength(0);
  });

  it('404s a missing order', async () => {
    const user = await fx.user();
    await expect(
      request.requestZarinpalPayment(user.id, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('422s an order that is not awaiting payment', async () => {
    const { user, order } = await zarinpalOrder({
      status: ORDER_STATUSES.PAID,
    });

    await expect(
      request.requestZarinpalPayment(user.id, order.id),
    ).rejects.toMatchObject({ status: 422 });
    expect(await paymentsFor(order.id)).toHaveLength(0);
  });

  it('422s a COD order (no online gateway)', async () => {
    const { user, order } = await zarinpalOrder({
      paymentMethod: PAYMENT_METHODS.COD,
      status: ORDER_STATUSES.PENDING_PAYMENT,
    });

    await expect(
      request.requestZarinpalPayment(user.id, order.id),
    ).rejects.toMatchObject({ status: 422 });
  });
});
