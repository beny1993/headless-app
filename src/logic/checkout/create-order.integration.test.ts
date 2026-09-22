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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orders, payments } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const { createOrder, CheckoutError, MAX_OPEN_ORDERS } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { transitionOrder } = await importWithDb(
  () => import('@/logic/orders/state-machine'),
);
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('createOrder', () => {
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

  // The mid-transaction tests below spy on ProductDao.getByIds; restore it so a
  // spy never leaks into the next test.
  afterEach(() => vi.restoreAllMocks());

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

    it('snapshots a family member by its displayed name, label and all', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const head = await fx.product(category, {
        title: 'غذای خشک سگ',
        variantLabel: '۵ کیلوگرم',
        price: 250_000,
        stock: 5,
      });
      const member = await fx.product(category, {
        title: 'غذای خشک سگ',
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
        price: 450_000,
        stock: 5,
      });
      const prov = await province();

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: member.id, qty: 1 }]),
      );
      fx.remember(order.id);

      // The snapshot is the only record of *which* size was bought once the
      // product row is edited — the bare `title` is shared by the whole family,
      // so an invoice reading «غذای خشک سگ» could mean either.
      expect(order.items[0].title).toBe('غذای خشک سگ — ۱۰ کیلوگرم');
      expect(order.items[0].unitPrice).toBe(450_000);
    });

    it('snapshots the price from the reservation RETURNING row, not the pre-load', async () => {
      // Deviation 1's load-bearing claim: the snapshot is decrementStock's fresh
      // RETURNING row, NOT the getByIds pre-load. The only case that tells the two
      // apart is a price that changes AFTER the pre-load but BEFORE the row is
      // reserved — a window a plain "edit before checkout" cannot reach, because
      // getByIds would already see the new price. Inject exactly there: spy on
      // getByIds to run the price edit on the pool (autocommit) once the tx has
      // SELECTed but taken no row lock, then reserve. Pre-load sees 100_000; the
      // reservation re-reads 150_000, and the snapshot must be the latter.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province();

      const realGetByIds = ProductDao.getByIds;
      vi.spyOn(ProductDao, 'getByIds').mockImplementation(
        async (executor, ids) => {
          const rows = await realGetByIds(executor, ids);
          await ProductDao.update(product.id, { price: 150_000 });
          return rows;
        },
      );

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }]),
      );
      fx.remember(order.id);

      // 150_000, not the 100_000 the pre-load saw: snapshotting the pre-load row
      // instead of the RETURNING row makes this 100_000 and the subtotal 200_000.
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

    it('rejects a product soft-deleted mid-transaction, rolling the reservation back (TOCTOU recheck)', async () => {
      // decrementStock deliberately ignores isActive, so a soft-delete that lands
      // AFTER the pre-load saw the product active but BEFORE (or as) it reserves
      // is caught only by the post-decrement recheck of the fresh RETURNING row.
      // Inject the soft-delete in that window via a getByIds spy (pool autocommit;
      // the tx holds no row lock yet). The recheck must reject and roll back the
      // decrement — otherwise the reservation stands and stock leaks to 4.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const realGetByIds = ProductDao.getByIds;
      vi.spyOn(ProductDao, 'getByIds').mockImplementation(
        async (executor, ids) => {
          const rows = await realGetByIds(executor, ids);
          await ProductDao.softDelete(product.id); // active at load, gone before reserve
          return rows;
        },
      );

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 1 }]),
        ),
      ).rejects.toMatchObject({ field: 'items.0' });
      expect(await stockOf(product.id)).toBe(5); // reservation rolled back
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

    it('rejects an unknown discount code, naming the field and reserving nothing', async () => {
      // The full discount-application behaviour (money math, atomic usage claim,
      // concurrency) is in create-order.discount.integration.test.ts; this pins
      // that an unknown code is a client-fixable 422 on the field, not a 500, and
      // that the whole order (including the reservation) rolls back.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          buildInput(prov, [{ productId: product.id, qty: 1 }], {
            discountCode: 'NO-SUCH-CODE',
          }),
        ),
      ).rejects.toMatchObject({ field: 'discountCode' });
      expect(await stockOf(product.id)).toBe(5);
      expect(await ordersForUser(user.id)).toHaveLength(0);
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
      // Lines are reserved in productId order. Both products start well-stocked;
      // AFTER sorting by id we starve the one that sorts LAST, so the first line
      // is really reserved before the second fails — the only arrangement that
      // exercises rollback (making the short one up front would fail before
      // anything was reserved and pass trivially).
      const user = await fx.user();
      const category = await fx.category();
      const p1 = await fx.product(category, { stock: 10 });
      const p2 = await fx.product(category, { stock: 10 });
      const [good, short] = [p1, p2].sort((x, y) => (x.id < y.id ? -1 : 1));
      await ProductDao.update(short.id, { stock: 1 });
      const prov = await province();

      await expect(
        createOrder(
          user.id,
          // `short` is placed FIRST in the request but sorts LAST by id, so its
          // request index (0) differs from its reservation/sorted index (1):
          // `good` is reserved first, then `short` fails.
          buildInput(prov, [
            { productId: short.id, qty: 2 }, // request index 0 — fails (stock 1)
            { productId: good.id, qty: 3 }, // request index 1 — reserved first
          ]),
        ),
        // `items.0`, the request index of `short`, NOT `items.1` its sorted
        // index: this pins that the error names the line the CLIENT sent and
        // catches a regression to the productId-sorted index.
      ).rejects.toMatchObject({ field: 'items.0' });

      // The earlier-reserved line was rolled back with the failed order.
      expect(await stockOf(good.id)).toBe(10);
      expect(await stockOf(short.id)).toBe(1);
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });
  });

  describe('stock restore on cancel (AC 5)', () => {
    it('restores the stock a checkout reserved when the order is later cancelled', async () => {
      // End-to-end: checkout reserves through the order's item snapshots, and a
      // cancel of the pending_payment order must return exactly that. Proves the
      // item rows checkout writes drive the state machine's restock — the schema
      // story's own suite tests transitionOrder in isolation; this pins the seam.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      );
      fx.remember(order.id);
      expect(await stockOf(product.id)).toBe(3); // reserved

      await testDb.transaction((tx) =>
        transitionOrder(
          tx,
          order.id,
          ORDER_STATUSES.PENDING_PAYMENT,
          ORDER_STATUSES.CANCELLED,
        ),
      );

      expect(await stockOf(product.id)).toBe(5); // restored
    });
  });

  describe('online payment switched off', () => {
    // `APP_CONFIG_ZARINPAL_ENABLED` is the switch the checkout page reads to
    // hide the online-payment option. A page is not a boundary: the API takes
    // `paymentMethod` from the body, so without this guard a client could post
    // `zarinpal` to a card-to-card-only shop, land `pending_payment` and hold
    // the stock — with no release path, because the gateway guard stops the
    // payment request AND the reconcile sweep that would expire it.
    beforeEach(() => vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'false'));

    it('refuses a zarinpal order and reserves nothing', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      ).catch((e) => e);

      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.field).toBe('paymentMethod');
      expect(error.message).toMatch(/[؀-ۿ]/); // Persian, customer-facing
      expect(await stockOf(product.id)).toBe(5);
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });

    it('leaves card to card alone — that is the whole point of the shop', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }], {
          paymentMethod: PAYMENT_METHODS.COD,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PROCESSING);
      expect(await stockOf(product.id)).toBe(3);
    });

    it('treats an unset switch as off, as every other reader does', async () => {
      vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', '');
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      ).catch((e) => e);

      expect(error).toBeInstanceOf(CheckoutError);
      expect(await stockOf(product.id)).toBe(5);
    });
  });

  describe('interim open-order cap', () => {
    // Seed N orders in `status` directly (no stock decrement, no checkout) so the
    // one createOrder call under test is unambiguously the guarded one.
    const seedOrders = async (
      user: Parameters<OrderFixtures['buildOrder']>[0],
      product: Parameters<OrderFixtures['buildOrder']>[1][number]['product'],
      n: number,
      status: OrderStatus = ORDER_STATUSES.PENDING_PAYMENT,
    ) => {
      for (let i = 0; i < n; i++) {
        const order = await OrderDao.create(
          fx.buildOrder(user, [{ product }], { status }),
        );
        fx.remember(order.id);
      }
    };

    it('rejects a pending_payment (Zarinpal) checkout once the user is at the cap', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      await seedOrders(user, product, MAX_OPEN_ORDERS);

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      ).catch((e) => e);

      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.field).toBe('paymentMethod');
      expect(error.message).toMatch(/[؀-ۿ]/); // Persian, customer-facing
      // Nothing reserved, no order created: the guard is pre-transaction.
      expect(await stockOf(product.id)).toBe(5);
      expect(await ordersForUser(user.id)).toHaveLength(MAX_OPEN_ORDERS);
    });

    it('allows a Zarinpal checkout while the user is under the cap', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      await seedOrders(user, product, MAX_OPEN_ORDERS - 1);

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      expect(await ordersForUser(user.id)).toHaveLength(MAX_OPEN_ORDERS);
    });

    it('ignores non-open orders — a paid/delivered/cancelled backlog does not count', async () => {
      // Well over the cap in count, but none are pending_payment. A guard that
      // counted all statuses (the wrong filter) would reject this checkout.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const backlog = [
        ORDER_STATUSES.PAID,
        ORDER_STATUSES.PROCESSING,
        ORDER_STATUSES.SHIPPED,
        ORDER_STATUSES.DELIVERED,
        ORDER_STATUSES.CANCELLED,
        ORDER_STATUSES.FAILED,
      ];
      expect(backlog.length).toBeGreaterThan(MAX_OPEN_ORDERS);
      for (const status of backlog) await seedOrders(user, product, 1, status);

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.ZARINPAL,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    });

    it('never blocks a COD checkout, even at the cap (COD enters at processing)', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      await seedOrders(user, product, MAX_OPEN_ORDERS);

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          paymentMethod: PAYMENT_METHODS.COD,
        }),
      );
      fx.remember(order.id);

      expect(order.status).toBe(ORDER_STATUSES.PROCESSING);
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
