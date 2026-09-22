// Idempotent order creation — the HIGH carried-in constraint from the checkout
// security pass. A double-submit or a concurrent retry that reuses the same
// `Idempotency-Key` must yield ONE order (a second `processing` COD order is a
// second fulfillment), charged once, with stock decremented once.
//
// Needs a live database — see src/db/test-db.ts — because every guarantee here is
// a property of real transactions and a real partial unique index: the losing
// insert of a concurrent race trips 23505 and rolls its reservation back, which a
// mocked `db` cannot show. Same rigor as the oversell suite next door; the
// discriminator is that BOTH concurrent calls here succeed with the SAME order,
// where oversell has exactly one rejection.
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orders, payments } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const { createOrder, CheckoutError, MAX_OPEN_ORDERS } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);
const key = () => crypto.randomUUID();

describe.skipIf(!databaseReachable)('createOrder idempotency', () => {
  // Online payment is OFF by default, and `createOrder` now refuses a
  // `zarinpal` order while it is — the API boundary the checkout page's hidden
  // option was never a substitute for. These suites are about what a zarinpal
  // order does once it exists, so they switch the feature on. The refusal
  // itself is pinned in «online payment switched off» below.
  beforeEach(() => vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];

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

  const stockOf = async (id: string) => {
    const [row] = await testDb
      .select({ stock: productsTable.stock })
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);
    return row.stock;
  };

  const ordersForUser = async (userId: string) =>
    testDb.select().from(orders).where(eq(orders.userId, userId));

  const paymentsForOrder = async (orderId: string) =>
    testDb.select().from(payments).where(eq(payments.orderId, orderId));

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

  describe('concurrency', () => {
    it('two concurrent COD checkouts with the same key create exactly one order, decrementing stock once', async () => {
      // Ample stock so BOTH decrements clear the oversell guard — the collision
      // must land on the partial unique index (23505), not the stock guard.
      // 5 - 2 = 3, and 3 >= 2, so the loser reserves before it hits the index.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province(40_000);
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 2 }]);

      const results = await Promise.allSettled([
        createOrder(user.id, input, k),
        createOrder(user.id, input, k),
      ]);

      // Both succeed — the discriminator from the oversell test, where one
      // rejects. The loser returned the winner's already-created order.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(2);
      const [a, b] = fulfilled as PromiseFulfilledResult<{ id: string }>[];
      expect(a.value.id).toBe(b.value.id);

      // Exactly one order, one COD payment row, stock decremented once.
      const created = await ordersForUser(user.id);
      created.forEach((o) => fx.remember(o.id));
      expect(created).toHaveLength(1);
      expect(await stockOf(product.id)).toBe(3);
      const pays = await paymentsForOrder(a.value.id);
      expect(pays).toHaveLength(1);
      expect(pays[0].method).toBe(PAYMENT_METHODS.COD);
      expect(pays[0].status).toBe(PAYMENT_STATUSES.PENDING);
    });

    it('the winner takes the last unit and the loser gets a stock error, never a second order or a double decrement', async () => {
      // The benign edge the design flags: with only ONE unit, the loser's atomic
      // decrement finds 0 rows and throws an insufficient-stock CheckoutError
      // BEFORE it can reach the unique index — so the losing branch is the stock
      // guard, not the 23505 catch (unlike the ample-stock race above, where both
      // fulfil). What the money invariant demands is asserted deterministically:
      // exactly ONE order, stock decremented exactly ONCE (never stranded, never
      // twice), and any losing call fails with a client-fixable CheckoutError on
      // the offending line — never a 500, never a second reservation.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 1 });
      const prov = await province(40_000);
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);

      const results = await Promise.allSettled([
        createOrder(user.id, input, k),
        createOrder(user.id, input, k),
      ]);

      const created = await ordersForUser(user.id);
      created.forEach((o) => fx.remember(o.id));

      // The invariant, regardless of how the two calls interleave: one order, one
      // decrement to zero.
      expect(created).toHaveLength(1);
      expect(await stockOf(product.id)).toBe(0);

      // At least the winner returned the created order; every returned order is
      // that one order (no phantom second id).
      const fulfilled = results.filter(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string }>[];
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      fulfilled.forEach((r) => expect(r.value.id).toBe(created[0].id));

      // Any losing call is a benign, client-fixable stock error on the line —
      // not a raw 23505, not an unexpected 500.
      const rejected = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];
      rejected.forEach((r) => {
        expect(r.reason).toBeInstanceOf(CheckoutError);
        expect((r.reason as InstanceType<typeof CheckoutError>).field).toBe(
          'items.0',
        );
      });
    });
  });

  describe('sequential replay', () => {
    it('returns the same order and does not decrement again', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province();
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 2 }]);

      const first = await createOrder(user.id, input, k);
      fx.remember(first.id);
      expect(await stockOf(product.id)).toBe(3);

      const second = await createOrder(user.id, input, k);

      expect(second.id).toBe(first.id);
      expect(await stockOf(product.id)).toBe(3); // not decremented again
      expect(await ordersForUser(user.id)).toHaveLength(1);
      expect(await paymentsForOrder(first.id)).toHaveLength(1);
    });

    it('replays an order that took the last unit without a 422 (the pre-check is a correctness requirement)', async () => {
      // Without the fast-path pre-check, the replay would re-enter the
      // transaction, the stock guard would find 0 units and throw an
      // insufficient-stock CheckoutError before the unique index ever caught it.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 1 });
      const prov = await province();
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);

      const first = await createOrder(user.id, input, k);
      fx.remember(first.id);
      expect(await stockOf(product.id)).toBe(0);

      const second = await createOrder(user.id, input, k);

      expect(second.id).toBe(first.id);
      expect(await stockOf(product.id)).toBe(0);
    });

    it('replays a Zarinpal order that put the user at the open-order cap (the cap must not reject the replay)', async () => {
      // Seed the user to one below the cap, then create the keyed Zarinpal order
      // (now AT the cap). A replay counts that order toward the cap; without the
      // pre-check it would 422 TOO_MANY_OPEN_ORDERS instead of returning it.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      for (let i = 0; i < MAX_OPEN_ORDERS - 1; i++) {
        const seeded = await OrderDao.create(
          fx.buildOrder(user, [{ product }], {
            status: ORDER_STATUSES.PENDING_PAYMENT,
          }),
        );
        fx.remember(seeded.id);
      }
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }], {
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      });

      const first = await createOrder(user.id, input, k);
      fx.remember(first.id);
      expect(await ordersForUser(user.id)).toHaveLength(MAX_OPEN_ORDERS);

      const second = await createOrder(user.id, input, k);

      expect(second.id).toBe(first.id);
      expect(await ordersForUser(user.id)).toHaveLength(MAX_OPEN_ORDERS);
    });
  });

  describe('key scope', () => {
    it('creates two distinct orders for two different keys (same user, same cart)', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);

      const one = await createOrder(user.id, input, key());
      const two = await createOrder(user.id, input, key());
      fx.remember(one.id);
      fx.remember(two.id);

      expect(one.id).not.toBe(two.id);
      expect(await stockOf(product.id)).toBe(3); // decremented twice
      expect(await ordersForUser(user.id)).toHaveLength(2);
    });

    it('scopes the key to the user — the same key for two users makes two orders', async () => {
      const userA = await fx.user();
      const userB = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);
      const shared = key();

      const a = await createOrder(userA.id, input, shared);
      const b = await createOrder(userB.id, input, shared);
      fx.remember(a.id);
      fx.remember(b.id);

      expect(a.id).not.toBe(b.id);
      expect(await ordersForUser(userA.id)).toHaveLength(1);
      expect(await ordersForUser(userB.id)).toHaveLength(1);
    });

    it('does not deduplicate when no key is supplied (idempotency requires a key)', async () => {
      // The logic layer tolerates an absent key (a direct caller, a legacy path);
      // the route makes the header required. Two keyless calls are two orders.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);

      const one = await createOrder(user.id, input);
      const two = await createOrder(user.id, input);
      fx.remember(one.id);
      fx.remember(two.id);

      expect(one.id).not.toBe(two.id);
      expect(await ordersForUser(user.id)).toHaveLength(2);
    });
  });
});
