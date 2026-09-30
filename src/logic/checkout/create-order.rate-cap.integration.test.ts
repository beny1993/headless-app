// The rolling per-user creation cap — the anti-abuse guard that bounds how many
// orders one verified account can create in an hour, whatever it pays with and
// whatever becomes of them afterwards.
//
// What it defends: a COD checkout is `processing` from birth, so the open-order
// cap next door never counted it. One shopper looping POST /api/checkout with a
// fresh Idempotency-Key could therefore mint orders without limit — each one an
// SMS to every admin and a row burying the real orders on /admin-panel/orders.
//
// Needs a live database — see src/db/test-db.ts: the cap is a COUNT over
// committed rows, including ones this checkout is not allowed to see the end of.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { orders } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import type { User } from '@/db/schema/auth';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import { CheckoutError } from '@/logic/checkout/checkout-error';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

// A refused checkout must not reach the admins' phones either.
vi.mock('@/logic/orders/notify-new-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/logic/orders/notify-new-order')>()),
  notifyAdminsOfNewOrder: mocks.notify,
}));

const {
  createOrder,
  MAX_OPEN_ORDERS,
  MAX_ORDERS_PER_WINDOW,
  ORDER_RATE_WINDOW_MS,
} = await importWithDb(() => import('@/logic/checkout/create-order'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('createOrder rate cap', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];

  beforeEach(() => mocks.notify.mockClear());
  afterEach(async () => {
    vi.unstubAllEnvs();
    // Belt and braces: a test that expects a refusal has no order id to
    // remember, so if the cap ever stops refusing (a revert, a regression) the
    // order it wrongly created would otherwise be left behind to block the
    // product delete below — and the failure would read as a teardown bug.
    if (fx.userIds.length > 0) {
      await testDb.delete(orders).where(inArray(orders.userId, fx.userIds));
    }
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

  /**
   * `count` bare order rows for `user`, inserted in one statement — the cap
   * counts rows, and a full checkout each time would only make the suite slow.
   */
  const seedOrders = async (
    user: User,
    howMany: number,
    overrides: {
      status?: (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];
      createdAt?: Date;
    } = {},
  ) => {
    if (howMany === 0) return;
    const rows = await testDb
      .insert(orders)
      .values(
        Array.from({ length: howMany }, () => ({
          userId: user.id,
          status: overrides.status ?? ORDER_STATUSES.PROCESSING,
          paymentMethod: PAYMENT_METHODS.COD,
          subtotal: 100_000,
          shippingFee: 0,
          total: 100_000,
          provinceName: 'تهران',
          recipientName: 'گیرنده آزمایشی',
          recipientPhone: '+989120000000',
          city: 'تهران',
          postalCode: '1234567890',
          addressLine: 'خیابان آزمایشی، پلاک ۱',
          ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
        })),
      )
      .returning();
    rows.forEach((row) => fx.remember(row.id));
  };

  const scenario = async (
    overrides: Partial<CheckoutInput> = {},
    stock = 5,
  ) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock });
    const prov = await province(40_000);
    const input: CheckoutInput = {
      items: [{ productId: product.id, qty: 1 }],
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
    };
    return { user, product, input };
  };

  const ordersOf = async (userId: string) =>
    testDb.select().from(orders).where(eq(orders.userId, userId));

  const stockOf = async (id: string) =>
    (await testDb.select().from(products).where(eq(products.id, id)))[0].stock;

  it('refuses the order after the cap, reserving nothing and telling nobody', async () => {
    const { user, product, input } = await scenario();
    await seedOrders(user, MAX_ORDERS_PER_WINDOW);

    await expect(createOrder(user.id, input)).rejects.toBeInstanceOf(
      CheckoutError,
    );

    // 422 shape, not a 500: a field the checkout form already renders.
    const error = await createOrder(user.id, input).catch((e) => e);
    expect(error.field).toBe('paymentMethod');
    expect(error.message).toMatch(/[؀-ۿ]/);
    // Nothing created, nothing reserved, nothing sent.
    expect(await ordersOf(user.id)).toHaveLength(MAX_ORDERS_PER_WINDOW);
    expect(await stockOf(product.id)).toBe(5);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('refuses a Zarinpal checkout on the same cap', async () => {
    // The open-order cap only ever counted `pending_payment`; this one counts
    // every order, so neither payment method is a way around the other's guard.
    // Online payment has to be on: switched off, createOrder refuses every
    // Zarinpal order first — the same CheckoutError on the same field — and
    // this case would pass with the cap gone.
    vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'true');
    const { user, input } = await scenario({
      paymentMethod: PAYMENT_METHODS.ZARINPAL,
    });
    await seedOrders(user, MAX_ORDERS_PER_WINDOW);

    const error = await createOrder(user.id, input).catch((e) => e);
    expect(error).toBeInstanceOf(CheckoutError);
    // The cap's own refusal, not the open-order cap's or the gateway's.
    expect(error.message).toContain('یک ساعت گذشته');
  });

  it('still allows the last order below the cap', async () => {
    // The boundary in the other direction: a cap that fired one order early
    // would turn a busy real shopper away.
    const { user, input } = await scenario();
    await seedOrders(user, MAX_ORDERS_PER_WINDOW - 1);

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    expect(order.status).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
  });

  it('counts orders the shopper has cancelled', async () => {
    // Otherwise the attacker re-arms: create to the cap, cancel them all, go
    // again. Stock moved and an SMS went out for every one of them.
    const { user, input } = await scenario();
    await seedOrders(user, MAX_ORDERS_PER_WINDOW, {
      status: ORDER_STATUSES.CANCELLED,
    });

    await expect(createOrder(user.id, input)).rejects.toBeInstanceOf(
      CheckoutError,
    );
  });

  it('forgets orders older than the window', async () => {
    // A rolling window, not a lifetime quota: a returning customer with a long
    // history is not locked out of the shop.
    const { user, input } = await scenario();
    await seedOrders(user, MAX_ORDERS_PER_WINDOW, {
      createdAt: new Date(Date.now() - ORDER_RATE_WINDOW_MS - 60_000),
    });

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    expect(order.id).toBeTruthy();
  });

  it('never counts another shopper’s orders', async () => {
    // The cap is per user, taken from the session at the call site. One busy
    // customer must not close the shop for everybody else.
    const { user, input } = await scenario();
    const stranger = await fx.user();
    await seedOrders(stranger, MAX_ORDERS_PER_WINDOW);

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    expect(order.userId).toBe(user.id);
  });

  it('lets an idempotent replay through after the cap is reached', async () => {
    // A replay returns the order the first attempt created — it creates
    // nothing, so refusing it would break a retry the shopper already paid for.
    const { user, input } = await scenario();
    const idempotencyKey = crypto.randomUUID();
    const first = await createOrder(user.id, input, idempotencyKey);
    fx.remember(first.id);
    await seedOrders(user, MAX_ORDERS_PER_WINDOW);

    const replay = await createOrder(user.id, input, idempotencyKey);

    expect(replay.id).toBe(first.id);
  });
  describe('under a concurrent burst from one account', () => {
    // Both caps count committed rows. Fired at once, every request used to read
    // the same count before any of them had committed, so a whole burst went
    // through — a review measured 120 of 120 committed, and 74 SMS from one
    // burst over HTTP. However the requests interleave, the caps must hold.
    const fire = (size: number, run: () => Promise<unknown>) =>
      Promise.allSettled(Array.from({ length: size }, run));

    const refusals = (results: PromiseSettledResult<unknown>[]) =>
      results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );

    it('commits exactly the creation cap, and alerts exactly that often', async () => {
      const size = MAX_ORDERS_PER_WINDOW + 10;
      const { user, input } = await scenario({}, size);

      const results = await fire(size, () =>
        createOrder(user.id, input, crypto.randomUUID()),
      );

      expect(await ordersOf(user.id)).toHaveLength(MAX_ORDERS_PER_WINDOW);
      expect(mocks.notify).toHaveBeenCalledTimes(MAX_ORDERS_PER_WINDOW);
      const refused = refusals(results);
      expect(refused).toHaveLength(10);
      for (const error of refused) {
        expect(error).toBeInstanceOf(CheckoutError);
        expect(error.message).toContain('یک ساعت گذشته');
      }
    });

    it('commits exactly the open-order cap of Zarinpal checkouts', async () => {
      vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'true');
      const size = MAX_OPEN_ORDERS + 5;
      const { user, input } = await scenario(
        { paymentMethod: PAYMENT_METHODS.ZARINPAL },
        size,
      );

      const results = await fire(size, () =>
        createOrder(user.id, input, crypto.randomUUID()),
      );

      const created = await ordersOf(user.id);
      expect(created).toHaveLength(MAX_OPEN_ORDERS);
      expect(
        created.every((row) => row.status === ORDER_STATUSES.PENDING_PAYMENT),
      ).toBe(true);
      const refused = refusals(results);
      expect(refused).toHaveLength(5);
      for (const error of refused) {
        expect(error).toBeInstanceOf(CheckoutError);
        expect(error.message).toContain('در انتظار پرداخت');
      }
    });

    it('hands a queued replay its order back, even the order that filled the cap', async () => {
      // Five copies of one request, one below the cap. The first to commit
      // fills it; every copy queued behind it must get that order back, never
      // the cap's 422 — a double-submit is not a new order.
      const { user, input } = await scenario();
      await seedOrders(user, MAX_ORDERS_PER_WINDOW - 1);
      const k = crypto.randomUUID();

      const results = await fire(5, () => createOrder(user.id, input, k));

      expect(refusals(results)).toEqual([]);
      const ids = new Set(
        results.map((result) =>
          result.status === 'fulfilled'
            ? (result.value as { id: string }).id
            : null,
        ),
      );
      expect(ids.size).toBe(1);
      expect(await ordersOf(user.id)).toHaveLength(MAX_ORDERS_PER_WINDOW);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    });
  });
});
