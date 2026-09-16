// WHERE the alert fires, and — mostly — where it does not. The notify module is
// mocked here, so every assertion is an exact call count taken the moment the
// hook site returns: `notifyAdminsOfNewOrder` is invoked synchronously right
// after the transaction commits, which makes a negative («a replay adds
// nothing») provable without waiting for anything.
//
// The other half — what the admins actually receive, and that a failing sender
// cannot touch the caller — is notify-new-order.integration.test.ts.
//
// Needs a live database — see src/db/test-db.ts — because the two hooks are
// defined by transaction outcomes: a committed order, a won/lost CAS, the
// partial unique index catching a concurrent replay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { orders, payments, type Payment } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import type { ZarinpalClient } from '@/lib/zarinpal/client';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

// Partial: `notifiesOnSettle` stays real, because the settle hook's decision is
// the thing under test. Only the send is stubbed out.
vi.mock('@/logic/orders/notify-new-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/logic/orders/notify-new-order')>()),
  notifyAdminsOfNewOrder: mocks.notify,
}));

const { createOrder } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { handleCallback, settlePendingPayment } = await importWithDb(
  () => import('@/logic/payments/verify'),
);
const { reconcilePayments } = await importWithDb(
  () => import('@/logic/payments/reconcile'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);
const key = () => crypto.randomUUID();

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

describe.skipIf(!databaseReachable)('the new-order alert hooks', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];

  beforeEach(() => mocks.notify.mockClear());
  afterEach(async () => {
    await fx.cleanup();
    if (provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, provinceIds));
      await testDb.delete(provinces).where(inArray(provinces.id, provinceIds));
      provinceIds.length = 0;
    }
  });

  const province = async (fee = 50_000) => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee,
    });
    provinceIds.push(row.provinceId);
    return row;
  };

  const buildInput = (
    prov: { provinceId: number },
    items: CheckoutInput['items'],
    overrides: Partial<CheckoutInput> = {},
  ): CheckoutInput => ({
    items,
    address: {
      recipientName: 'گیرنده آزمایشی',
      recipientPhone: '09120000000',
      provinceId: prov.provinceId,
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان آزمایشی، پلاک ۱',
    },
    paymentMethod: PAYMENT_METHODS.COD,
    ...overrides,
  });

  /** A checkout, ready to run. */
  const checkout = async (overrides: Partial<CheckoutInput> = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock: 5 });
    const prov = await province(40_000);
    return {
      user,
      product,
      input: buildInput(prov, [{ productId: product.id, qty: 2 }], overrides),
    };
  };

  /** A `pending_payment` Zarinpal order with one pending attempt on it. */
  const awaitingPayment = async ({ total = 340_000 } = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], { total }),
    );
    fx.remember(order.id);
    const payment = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: total,
      authority: `A-${crypto.randomUUID()}`,
    });
    return { order, payment };
  };

  describe('createOrder', () => {
    it('tells the admins about a committed card-to-card order', async () => {
      const { user, input } = await checkout();

      const order = await createOrder(user.id, input);
      fx.remember(order.id);

      expect(mocks.notify).toHaveBeenCalledTimes(1);
      expect(mocks.notify).toHaveBeenCalledWith(order.id);
    });

    it('says nothing about a Zarinpal order — it is not paid yet', async () => {
      // Born `pending_payment`: an unfinished checkout, and the one thing an
      // admin must never be woken up for. Its alert comes from the settle.
      const { user, input } = await checkout({
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      });

      const order = await createOrder(user.id, input);
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('adds nothing when the same Idempotency-Key is replayed', async () => {
      const { user, input } = await checkout();
      const k = key();

      const first = await createOrder(user.id, input, k);
      const second = await createOrder(user.id, input, k);
      fx.remember(first.id);

      expect(second.id).toBe(first.id);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    });

    it('adds nothing when the loser of a concurrent race returns the winner’s order', async () => {
      // The OTHER replay branch: both calls get past the fast path, the loser's
      // insert trips the partial unique index and its catch re-reads the winner.
      // Ample stock so the collision lands on the index, not the stock guard.
      const { user, input } = await checkout();
      const k = key();

      const [a, b] = await Promise.all([
        createOrder(user.id, input, k),
        createOrder(user.id, input, k),
      ]);
      fx.remember(a.id);

      expect(b.id).toBe(a.id);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('settlePendingPayment', () => {
    it('tells the admins when a payment settles the order paid', async () => {
      const { order, payment } = await awaitingPayment();

      expect(await settlePendingPayment(payment, stubClient())).toBe('paid');

      expect(mocks.notify).toHaveBeenCalledTimes(1);
      expect(mocks.notify).toHaveBeenCalledWith(order.id);
    });

    it('says nothing when the shopper cancelled at the gateway', async () => {
      const { payment } = await awaitingPayment();

      expect(await handleCallback(payment, 'NOK', stubClient())).toBe('failed');

      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('says nothing when verify refuses the payment', async () => {
      const { payment } = await awaitingPayment();
      const client = stubClient({
        verifyPayment: async () => ({ ok: false, code: -51, message: 'خطا' }),
      });

      expect(await settlePendingPayment(payment, client)).toBe('failed');

      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('says nothing on a replayed callback for an order already paid', async () => {
      // The admin was told when the first callback settled it. A shopper who
      // refreshes the return page must not send a second SMS.
      const { payment } = await awaitingPayment();
      await settlePendingPayment(payment, stubClient());
      mocks.notify.mockClear();

      const replayed = (
        await testDb.select().from(payments).where(eq(payments.id, payment.id))
      )[0] as Payment;
      expect(await handleCallback(replayed, 'OK', stubClient())).toBe(
        'already_paid',
      );

      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('says nothing when a late success is flagged for a manual refund', async () => {
      // Money taken for an order that had already moved on: a refund to make,
      // not a parcel to pack. Its own story, its own message.
      const { order, payment } = await awaitingPayment();
      await testDb
        .update(orders)
        .set({ status: ORDER_STATUSES.FAILED })
        .where(eq(orders.id, order.id));

      expect(await settlePendingPayment(payment, stubClient())).toBe(
        'refund_flagged',
      );

      expect(mocks.notify).not.toHaveBeenCalled();
    });
  });

  describe('the reconcile sweep', () => {
    it('settles a late payment through the same hook', async () => {
      // The sweep has no hook of its own: it calls settlePendingPayment, so the
      // one line above covers the cron path as well as the callback route.
      const { order, payment } = await awaitingPayment();
      await testDb
        .update(payments)
        .set({ createdAt: new Date(Date.now() - 30 * 60_000) })
        .where(eq(payments.id, payment.id));

      // Verify answers for THIS authority only and throws for anything else:
      // the sweep reads the whole table, and the shared dev database carries
      // stale attempts from other runs that must not be settled from here.
      await reconcilePayments(
        stubClient({
          verifyPayment: async ({ authority }) => {
            if (authority !== payment.authority) {
              throw new Error('not this suite’s payment');
            }
            return {
              ok: true,
              refId: 'ref-100',
              cardPan: '502229******5995',
              alreadyVerified: false,
            };
          },
        }),
      );

      expect(mocks.notify.mock.calls.flat()).toContain(order.id);
    });

    it('says nothing about an abandoned checkout it expires', async () => {
      // Pass 2's expiry restocks and closes the order. Nobody sold anything.
      // A client that throws keeps pass 1 from touching any other row.
      const { user, input } = await checkout({
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      });
      const order = await createOrder(user.id, input);
      fx.remember(order.id);
      await testDb
        .update(orders)
        .set({ createdAt: new Date(Date.now() - 2 * 60 * 60_000) })
        .where(eq(orders.id, order.id));
      mocks.notify.mockClear();

      await reconcilePayments(
        stubClient({
          verifyPayment: async () => {
            throw new Error('gateway unreachable');
          },
        }),
      );

      const [row] = await testDb
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(row.status).toBe(ORDER_STATUSES.FAILED);
      expect(mocks.notify.mock.calls.flat()).not.toContain(order.id);
      // …and the stock the abandoned order held came back.
      const [stocked] = await testDb
        .select()
        .from(products)
        .where(eq(products.id, input.items[0].productId));
      expect(stocked.stock).toBe(5);
    });
  });
});
