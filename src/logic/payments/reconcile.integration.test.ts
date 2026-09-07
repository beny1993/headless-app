// The reconcile/expiry sweep — the launch-gate that gives reserved stock a
// release path. Driven through the REAL mock driver + ledger (not a hand stub) so
// the driver's amount-checked verify is exercised end to end. Ages rows by
// back-dating createdAt, the existing convention.
//
// Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, payments } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import {
  mockDriver,
  mockLedger,
  type ZarinpalClient,
} from '@/lib/zarinpal/client';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
}));

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { reconcilePayments } = await importWithDb(
  () => import('@/logic/payments/reconcile'),
);

const MIN = 60_000;

describe.skipIf(!databaseReachable)('reconcilePayments', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    vi.restoreAllMocks();
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
      errored: 0,
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
      errored: 0,
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
      errored: 0,
    });
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.FAILED);
    expect(await stockOf(product.id)).toBe(initialStock); // still restocked once
  });

  it('isolates a throwing verify — one bad row does not block the rest of the sweep', async () => {
    // The real driver's verify can throw (fetch rejects, or an unparseable body).
    // Without per-payment isolation that would abort the loop and starve pass 2's
    // expiry indefinitely — the "flip to the real driver is one env change" bug.
    const a = await scenario(); // its verify will throw
    const b = await scenario(); // never paid → should still be expired
    await agePayment(a.payment.id, 20 * MIN);
    await agePayment(b.payment.id, 20 * MIN);
    await ageOrder(b.order.id, 2 * 60 * MIN);

    const throwingFor = (badAuthority: string): ZarinpalClient => ({
      requestPayment: async () => ({ authority: 'x', redirectUrl: 'x' }),
      verifyPayment: async ({ authority }) => {
        if (authority === badAuthority) throw new Error('gateway unreachable');
        return { ok: false, code: -51, message: 'not paid' };
      },
    });

    mocks.captureException.mockClear();
    const result = await reconcilePayments(throwingFor(a.payment.authority!));

    expect(result.errored).toBe(1); // a's verify threw, counted and skipped
    // The row stays `pending` and the sweep reports success overall, so a
    // payment that fails EVERY run is silent without this — and the money may
    // already have left the shopper's account.
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { paymentId: a.payment.id, orderId: a.order.id },
    });
    expect(result.expired).toBe(1); // b was still processed after a threw
    // a is untouched and stays retryable; its order is not expired (live attempt).
    expect((await paymentRow(a.payment.id)).status).toBe(
      PAYMENT_STATUSES.PENDING,
    );
    expect(await orderStatus(a.order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    // b failed and its order expired + restocked.
    expect(await orderStatus(b.order.id)).toBe(ORDER_STATUSES.FAILED);
    expect(await stockOf(b.product.id)).toBe(b.initialStock);
  });

  it('isolates a pass-2 InvalidTransition — an order that moved on mid-sweep does not abort the sweep', async () => {
    // Pass 2's per-order try/catch: if an order left pending_payment between the
    // worklist query and the expiry CAS (a concurrent callback paid it mid-pass),
    // its InvalidTransitionError must be swallowed so the rest of pass 2 still
    // runs. Without the catch, one such order starves every later expiry — the
    // launch-gate's "one bad row doesn't abort the sweep", for pass 2. Drive it by
    // injecting an already-moved-on order into pass 2's worklist.
    const abandoned = await scenario(); // genuinely abandoned → should expire
    await agePayment(abandoned.payment.id, 20 * MIN);
    await ageOrder(abandoned.order.id, 2 * 60 * MIN);

    const movedOn = await scenario();
    // No longer pending_payment (a callback paid it) and no live attempt, so pass 2
    // reaches the transition and loses the CAS → InvalidTransitionError.
    await testDb
      .update(orders)
      .set({ status: ORDER_STATUSES.PAID })
      .where(eq(orders.id, movedOn.order.id));
    await testDb
      .update(payments)
      .set({ status: PAYMENT_STATUSES.FAILED })
      .where(eq(payments.id, movedOn.payment.id));

    const realList = OrderDao.listExpiredPendingPayment.bind(OrderDao);
    vi.spyOn(OrderDao, 'listExpiredPendingPayment').mockImplementation(
      async (cutoff) => {
        const real = await realList(cutoff); // the genuinely-abandoned order
        const [injected] = await testDb
          .select()
          .from(orders)
          .where(eq(orders.id, movedOn.order.id));
        return [...real, injected]; // + the order that moved on mid-sweep
      },
    );

    // Must NOT throw: the moved-on order's InvalidTransitionError is isolated.
    const result = await reconcilePayments(mockDriver);

    expect(result.expired).toBe(1); // only the genuinely-abandoned order
    expect(result.failed).toBe(1); // abandoned's pass-1 verify (ledger empty)
    expect(result.errored).toBe(0); // the swallowed InvalidTransition is not an error
    expect(await orderStatus(abandoned.order.id)).toBe(ORDER_STATUSES.FAILED);
    expect(await stockOf(abandoned.product.id)).toBe(abandoned.initialStock);
    // The moved-on order is untouched — not expired, not restocked; sweep survived.
    expect(await orderStatus(movedOn.order.id)).toBe(ORDER_STATUSES.PAID);
  });
});
