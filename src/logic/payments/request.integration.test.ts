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

describe.skipIf(!databaseReachable)('payment attempt cap per order', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
  });

  const zarinpalOrder = async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], { total: 120_000 }),
    );
    fx.remember(order.id);
    return { user, order };
  };

  const attempts = async (orderId: string) =>
    testDb.select().from(payments).where(eq(payments.orderId, orderId));

  it('allows attempts up to the cap', async () => {
    const { user, order } = await zarinpalOrder();

    for (let i = 0; i < request.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i++) {
      await expect(
        request.requestZarinpalPayment(user.id, order.id),
      ).resolves.toMatchObject({ redirectUrl: expect.any(String) });
    }

    expect(await attempts(order.id)).toHaveLength(
      request.MAX_PAYMENT_ATTEMPTS_PER_ORDER,
    );
  });

  it('refuses the attempt past the cap with a 422 and Persian copy', async () => {
    const { user, order } = await zarinpalOrder();
    for (let i = 0; i < request.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i++) {
      await request.requestZarinpalPayment(user.id, order.id);
    }

    await expect(
      request.requestZarinpalPayment(user.id, order.id),
    ).rejects.toMatchObject({
      status: 422,
      message: request.TOO_MANY_PAYMENT_ATTEMPTS,
    });
  });

  it('does not mint a gateway authority for a refused attempt', async () => {
    // The whole point of the cap is the outbound request each attempt costs.
    // A refusal that still called the gateway would bound the row count and
    // nothing else.
    const { user, order } = await zarinpalOrder();
    for (let i = 0; i < request.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i++) {
      await request.requestZarinpalPayment(user.id, order.id);
    }

    const requestPayment = vi.spyOn(mockDriver, 'requestPayment');
    await expect(
      request.requestZarinpalPayment(user.id, order.id),
    ).rejects.toThrow();

    expect(requestPayment).not.toHaveBeenCalled();
    expect(await attempts(order.id)).toHaveLength(
      request.MAX_PAYMENT_ATTEMPTS_PER_ORDER,
    );
  });

  it('counts per order, not per user', async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 50 });
    const makeOrder = async () => {
      const order = await OrderDao.create(
        fx.buildOrder(user, [{ product, qty: 1 }], { total: 90_000 }),
      );
      fx.remember(order.id);
      return order;
    };

    const first = await makeOrder();
    const second = await makeOrder();

    for (let i = 0; i < request.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i++) {
      await request.requestZarinpalPayment(user.id, first.id);
    }
    await expect(
      request.requestZarinpalPayment(user.id, first.id),
    ).rejects.toMatchObject({ status: 422 });

    // The second order has its own ceiling — one exhausted order must not
    // lock the shopper out of a different one.
    await expect(
      request.requestZarinpalPayment(user.id, second.id),
    ).resolves.toMatchObject({ redirectUrl: expect.any(String) });
  });

  it('counts failed attempts too, so failing on purpose cannot reset the cap', async () => {
    const { user, order } = await zarinpalOrder();
    for (let i = 0; i < request.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i++) {
      await request.requestZarinpalPayment(user.id, order.id);
    }

    const rows = await attempts(order.id);
    await testDb
      .update(payments)
      .set({ status: PAYMENT_STATUSES.FAILED })
      .where(eq(payments.id, rows[0].id));

    await expect(
      request.requestZarinpalPayment(user.id, order.id),
    ).rejects.toMatchObject({ status: 422 });
  });
});
