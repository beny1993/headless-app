// The security-critical core of the shop. Needs a live database — see
// src/db/test-db.ts — because every guarantee here (atomic oversell under
// concurrency, whole-order rollback, server-authoritative re-pricing) is a
// property of real transactions a mocked `db` cannot show.
//
// What this suite pins, per the story's acceptance criteria and its two blocks of
// carried-in security constraints:
//   · money is re-priced from products.price, never trusted from the client
//   · inactive / missing / out-of-stock products are rejected, naming the line,
//     with nothing reserved
//   · oversell is impossible under concurrency; a mid-cart failure rolls the
//     whole order back and restores every earlier line's stock
//   · the shipping fee + province name are snapshotted from the SERVER lookup
//   · status comes from initialStatusFor(method), never the client; the COD
//     payment row is created `pending`; a Zarinpal order gets no payment row yet
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
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

const { createOrder, CheckoutError } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('createOrder', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];

  afterEach(async () => {
    // Orders (and their items/payments) go first — fx.cleanup deletes them, then
    // the products/categories/users. Provinces are removed last: orders.province_id
    // is a restrict FK, so a leftover order would block the province delete.
    await fx.cleanup();
    if (provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, provinceIds));
      await testDb.delete(provinces).where(inArray(provinces.id, provinceIds));
      provinceIds.length = 0;
    }
  });

  /** A throwaway province with a known fee for the checkout to snapshot. */
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

  describe('server-authoritative money', () => {
    it('re-prices every line from products.price and computes totals server-side', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const p1 = await fx.product(category, { price: 120_000, stock: 10 });
      const p2 = await fx.product(category, { price: 45_000, stock: 10 });
      const prov = await province(30_000);

      const order = await createOrder(
        user.id,
        buildInput(prov, [
          { productId: p1.id, qty: 2 },
          { productId: p2.id, qty: 3 },
        ]),
      );
      fx.remember(order.id);

      const subtotal = 120_000 * 2 + 45_000 * 3;
      expect(order.subtotal).toBe(subtotal);
      expect(order.shippingFee).toBe(30_000);
      expect(order.discount).toBe(0);
      expect(order.total).toBe(subtotal + 30_000);
    });

    it('snapshots title/sku/unitPrice per item from the product, not the client', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, {
        title: 'غذای گربه پرمیوم',
        price: 99_000,
        stock: 5,
      });
      const prov = await province();

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }]),
      );
      fx.remember(order.id);

      expect(order.items).toHaveLength(1);
      const [item] = order.items;
      expect(item.title).toBe('غذای گربه پرمیوم');
      expect(item.sku).toBe(product.sku);
      expect(item.unitPrice).toBe(99_000);
      expect(item.qty).toBe(1);
    });

    it('prices a later price edit into the order — re-reads at reservation time', async () => {
      // The snapshot comes from decrementStock's fresh RETURNING row, so a price
      // changed after the cart was built is the price the order records.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province();
      await ProductDao.update(product.id, { price: 150_000 });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }]),
      );
      fx.remember(order.id);

      expect(order.items[0].unitPrice).toBe(150_000);
      expect(order.subtotal).toBe(300_000);
    });
  });

  describe('rejects bad lines, reserving nothing', () => {
    it('rejects an inactive (soft-deleted) product, naming the line', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, {
        isActive: false,
        stock: 5,
      });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 1 }]),
        ),
      ).rejects.toMatchObject({ field: 'items.0' });
      expect(await stockOf(product.id)).toBe(5); // untouched
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });

    it('rejects a product id that does not exist', async () => {
      const user = await fx.user();
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: crypto.randomUUID(), qty: 1 }]),
        ),
      ).rejects.toBeInstanceOf(CheckoutError);
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });

    it('rejects insufficient stock, names the line, reserves nothing', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 2 });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 3 }]),
        ),
      ).rejects.toMatchObject({ field: 'items.0' });
      expect(await stockOf(product.id)).toBe(2); // not reserved
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });

    it('rejects a well-formed but unknown province, reserving nothing', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });

      await expect(
        createOrder(
          user.id,
          buildInput({ provinceId: 2_147_483_600 }, [
            { productId: product.id, qty: 1 },
          ]),
        ),
      ).rejects.toMatchObject({ field: 'address.provinceId' });
      expect(await stockOf(product.id)).toBe(5); // fail-fast, before any reserve
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });

    it('rejects a discount code until the discount story wires it', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 1 }], {
            discountCode: 'WELCOME10',
          }),
        ),
      ).rejects.toMatchObject({ field: 'discountCode' });
      expect(await stockOf(product.id)).toBe(5);
    });
  });

  describe('payment method drives entry status', () => {
    it('COD enters at processing with a pending COD payment row for the total', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 80_000, stock: 5 });
      const prov = await province(20_000);

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.COD,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PROCESSING);
      const [payment] = await testDb
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id));
      expect(payment.method).toBe(PAYMENT_METHODS.COD);
      expect(payment.status).toBe(PAYMENT_STATUSES.PENDING);
      expect(payment.amount).toBe(order.total);
      expect(payment.paidAt).toBeNull();
      expect(payment.authority).toBeNull();
    });

    it('Zarinpal enters at pending_payment with NO payment row yet', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      const rows = await testDb
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('snapshots the province', () => {
    it('records provinceId + provinceName + shippingFee from the server lookup', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province(77_000);

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }]),
      );
      fx.remember(order.id);

      expect(order.provinceId).toBe(prov.provinceId);
      expect(order.provinceName).toBe(prov.name);
      expect(order.shippingFee).toBe(77_000);
    });
  });

  describe('atomicity and concurrency', () => {
    it('never oversells the last unit — two racing checkouts, exactly one wins', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 1 });
      const prov = await province();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }]);

      const results = await Promise.allSettled([
        createOrder(user.id, input),
        createOrder(user.id, input),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        CheckoutError,
      );
      expect(await stockOf(product.id)).toBe(0); // never negative
      const created = await ordersForUser(user.id);
      expect(created).toHaveLength(1);
      created.forEach((o) => fx.remember(o.id));
    });

    it('rolls the whole order back when a later line fails, restoring earlier stock', async () => {
      // Lines are reserved in productId order. Make the product whose id sorts
      // LAST the short one, so an earlier line is reserved before the failure
      // hits — the only arrangement that proves the rollback restores it.
      const user = await fx.user();
      const category = await fx.category();
      let a = await fx.product(category, { stock: 10 });
      let b = await fx.product(category, { stock: 1 });
      // Ensure `b` (the short one, qty 2 > stock 1) sorts after `a`.
      if (a.id > b.id) [a, b] = [b, a];
      const good = a.id < b.id ? a : b; // sorts first, gets reserved
      const short = a.id < b.id ? b : a; // sorts last, fails
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [
            { productId: good.id, qty: 3 },
            { productId: short.id, qty: 2 },
          ]),
        ),
      ).rejects.toBeInstanceOf(CheckoutError);

      // The earlier line's reservation was rolled back with the failed order.
      expect(await stockOf(good.id)).toBe(good.stock);
      expect(await stockOf(short.id)).toBe(short.stock);
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });
  });

  describe('overflow backstop', () => {
    it('refuses a cart whose computed total exceeds the safe-integer range', async () => {
      // qty and line-count are bounded at the zod layer, but qty × price is not —
      // a corrupt near-2^53 price must fail the runtime guard, not silently store
      // a rounded bigint. Not a CheckoutError: it is an impossible-data invariant.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, {
        price: 9_000_000_000_000_000, // 9e15, times qty 2 exceeds 2^53
        stock: 5,
      });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 2 }]),
        ),
      ).rejects.toThrow(/safe-integer/);
      expect(await stockOf(product.id)).toBe(5); // rolled back
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });
  });

  describe('CheckoutError shape', () => {
    it('carries a field tag and a Persian customer-facing message', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 0 });
      const prov = await province();

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }]),
      ).catch((e) => e);

      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.field).toBe('items.0');
      expect(error.message).toMatch(/[؀-ۿ]/); // contains Persian
    });
  });
});
