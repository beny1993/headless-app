// Discount application at order creation — the MONEY + race-safety core of
// [[Story - Discount Codes]]. Needs a live database (see src/db/test-db.ts):
// every guarantee here (the usage limit holding under concurrency, the whole-tx
// rollback of a claimed use, server-side re-pricing of the discount) is a property
// of real transactions and the atomic claim, which a mocked `db` cannot show.
//
// The headline is `usage limit under concurrency`: N racing checkouts against one
// code limited to M must yield exactly M orders and `usage_count == M`, never
// more — the same rigor as the oversell and idempotency suites next door.
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { discountCodes } from '@/db/schema/discounts';
import { orders } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { DISCOUNT_TYPES } from '@/lib/discount/discount-code';
import { PAYMENT_METHODS } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const { createOrder, CheckoutError } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { DiscountCodeDao } = await importWithDb(
  () => import('@/db/dao/DiscountCodeDao'),
);
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);
const codeToken = () => crypto.randomUUID().slice(0, 8).toUpperCase();
const key = () => crypto.randomUUID();

describe.skipIf(!databaseReachable)('createOrder — discount codes', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];
  const codeIds: string[] = [];

  afterEach(async () => {
    await fx.cleanup();
    if (codeIds.length > 0) {
      await testDb
        .delete(discountCodes)
        .where(inArray(discountCodes.id, codeIds));
      codeIds.length = 0;
    }
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

  type CodeOverrides = {
    type?: (typeof DISCOUNT_TYPES)[keyof typeof DISCOUNT_TYPES];
    value?: number;
    expiresAt?: Date | null;
    usageLimit?: number | null;
    minOrderAmount?: number;
    isActive?: boolean;
  };

  const makeCode = async (over: CodeOverrides = {}) => {
    const row = await DiscountCodeDao.create({
      code: `SAVE-${codeToken()}`,
      type: over.type ?? DISCOUNT_TYPES.PERCENT,
      value: over.value ?? 10,
      expiresAt: over.expiresAt ?? null,
      usageLimit: over.usageLimit ?? null,
      minOrderAmount: over.minOrderAmount ?? 0,
      isActive: over.isActive ?? true,
    });
    codeIds.push(row.id);
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

  const usageOf = async (id: string) => {
    const [row] = await testDb
      .select({ usageCount: discountCodes.usageCount })
      .from(discountCodes)
      .where(eq(discountCodes.id, id))
      .limit(1);
    return row.usageCount;
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

  // ── Money math (server-computed, integer Toman) ──────────────────────────────

  describe('money math', () => {
    it('applies a percentage of the server-computed subtotal and snapshots it', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 10 });
      const prov = await province(30_000);
      const code = await makeCode({ type: DISCOUNT_TYPES.PERCENT, value: 10 });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 2 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);

      expect(order.subtotal).toBe(200_000);
      expect(order.discount).toBe(20_000); // 10% of 200,000
      expect(order.discountCode).toBe(code.code);
      expect(order.total).toBe(200_000 - 20_000 + 30_000);
      expect(await usageOf(code.id)).toBe(1);
    });

    it('floors a non-divisible percentage so the shop never over-discounts', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 33_333, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({ type: DISCOUNT_TYPES.PERCENT, value: 15 });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);

      // 15% of 33,333 = 4,999.95 → 4,999 (floor), total 33,333 - 4,999.
      expect(order.discount).toBe(4_999);
      expect(order.total).toBe(33_333 - 4_999);
    });

    it('applies a fixed amount below the subtotal', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 200_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({
        type: DISCOUNT_TYPES.FIXED,
        value: 50_000,
      });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);
      expect(order.discount).toBe(50_000);
      expect(order.total).toBe(150_000);
    });

    it('clamps a fixed amount larger than the subtotal to the subtotal (total = shipping only)', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 40_000, stock: 10 });
      const prov = await province(25_000);
      const code = await makeCode({
        type: DISCOUNT_TYPES.FIXED,
        value: 500_000,
      });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);
      expect(order.discount).toBe(40_000); // clamped to subtotal
      expect(order.total).toBe(25_000); // shipping only, never negative
    });

    it('a 100% code with free shipping yields a zero total (still a valid order)', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 80_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({ type: DISCOUNT_TYPES.PERCENT, value: 100 });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);
      expect(order.discount).toBe(80_000);
      expect(order.total).toBe(0);
    });

    it('applies when the subtotal exactly equals the minimum (boundary is >=)', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({
        type: DISCOUNT_TYPES.FIXED,
        value: 10_000,
        minOrderAmount: 100_000,
      });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);
      expect(order.discount).toBe(10_000);
    });
  });

  // ── Rejections — never apply, never consume a use, nothing reserved ───────────

  describe('rejections (never consume a use, nothing reserved)', () => {
    const expectRejected = async (
      user: { id: string },
      product: { id: string },
      code: { id: string; code: string },
      prov: { provinceId: number },
      qty = 1,
    ) => {
      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty }], {
          discountCode: code.code,
        }),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CheckoutError);
      expect((error as InstanceType<typeof CheckoutError>).field).toBe(
        'discountCode',
      );
      expect((error as InstanceType<typeof CheckoutError>).message).toMatch(
        /[؀-ۿ]/,
      );
      expect(await usageOf(code.id)).toBe(0); // no claim happened
      expect(await stockOf(product.id)).toBe(5); // nothing reserved
      expect(await ordersForUser(user.id)).toHaveLength(0);
    };

    it('rejects a below-minimum subtotal', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province();
      const code = await makeCode({ minOrderAmount: 500_000 });
      await expectRejected(user, product, code, prov);
    });

    it('rejects an expired code', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const code = await makeCode({ expiresAt: new Date(Date.now() - 60_000) });
      await expectRejected(user, product, code, prov);
    });

    it('rejects an inactive code', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      const code = await makeCode({ isActive: false });
      await expectRejected(user, product, code, prov);
    });

    it('rejects an already-exhausted code', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const prov = await province();
      // Limit 1, already used once — usage_count == usage_limit.
      const code = await makeCode({ usageLimit: 1 });
      await testDb.transaction((tx) => DiscountCodeDao.claim(tx, code.id));
      expect(await usageOf(code.id)).toBe(1);

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CheckoutError);
      expect((error as InstanceType<typeof CheckoutError>).field).toBe(
        'discountCode',
      );
      expect(await usageOf(code.id)).toBe(1); // still 1, never 2
      expect(await stockOf(product.id)).toBe(5);
      expect(await ordersForUser(user.id)).toHaveLength(0);
    });
  });

  // ── Sequential limit ─────────────────────────────────────────────────────────

  describe('usage limit (sequential)', () => {
    it('a limit-1 code applies once, then the next checkout is rejected as exhausted', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({ usageLimit: 1, value: 10 });

      const first = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(first.id);
      expect(first.discount).toBe(10_000);
      expect(await usageOf(code.id)).toBe(1);

      const error = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CheckoutError);
      expect(await usageOf(code.id)).toBe(1); // never 2
    });
  });

  // ── The headline: usage limit under concurrency ──────────────────────────────

  describe('usage limit under concurrency (the race-safety proof)', () => {
    it('N racing checkouts against a code limited to M yield exactly M orders and usage_count == M', async () => {
      const N = 6;
      const M = 2;
      const user = await fx.user();
      const category = await fx.category();
      const prov = await province(0);
      // Distinct products, one unit each, so the CONTENDED row is the discount
      // code — not a shared product row that would serialize every tx before it
      // ever reaches the claim. Each tx locks its own product then the shared
      // code: own-product → shared-code in every tx, so no deadlock.
      const products = await Promise.all(
        Array.from({ length: N }, () =>
          fx.product(category, { price: 100_000, stock: 1 }),
        ),
      );
      const code = await makeCode({
        type: DISCOUNT_TYPES.FIXED,
        value: 10_000,
        usageLimit: M,
      });

      const results = await Promise.allSettled(
        products.map((product) =>
          createOrder(
            user.id,
            buildInput(prov, [{ productId: product.id, qty: 1 }], {
              discountCode: code.code,
            }),
          ),
        ),
      );

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');

      // Exactly M succeed — the limit is never exceeded.
      expect(won).toHaveLength(M);
      expect(lost).toHaveLength(N - M);
      expect(await usageOf(code.id)).toBe(M);

      // Every loser is a client-fixable discount error, never a raw 500.
      lost.forEach((r) => {
        const reason = (r as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(CheckoutError);
        expect((reason as InstanceType<typeof CheckoutError>).field).toBe(
          'discountCode',
        );
      });

      // Winners kept their reservation (stock 0); losers rolled back (stock 1).
      await Promise.all(
        results.map(async (r, i) => {
          const stock = await stockOf(products[i].id);
          expect(stock).toBe(r.status === 'fulfilled' ? 0 : 1);
        }),
      );

      const created = await ordersForUser(user.id);
      created.forEach((o) => fx.remember(o.id));
      expect(created).toHaveLength(M);
      created.forEach((o) => {
        expect(o.discount).toBe(10_000);
        expect(o.discountCode).toBe(code.code);
      });
    });
  });

  // ── Idempotency × discount ───────────────────────────────────────────────────

  describe('idempotency × discount', () => {
    it('a sequential replay with the same key returns the order and does not re-claim', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({ usageLimit: 5, value: 10 });
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 1 }], {
        discountCode: code.code,
      });

      const first = await createOrder(user.id, input, k);
      fx.remember(first.id);
      expect(await usageOf(code.id)).toBe(1);

      const second = await createOrder(user.id, input, k);
      expect(second.id).toBe(first.id);
      expect(await usageOf(code.id)).toBe(1); // NOT re-claimed
    });

    it('two concurrent checkouts with the same key create one order and claim once', async () => {
      // Ample stock so both clear the oversell guard; the collision lands on the
      // idempotency unique index, and the loser's usage claim rolls back with it.
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const prov = await province(0);
      const code = await makeCode({ usageLimit: 5, value: 10 });
      const k = key();
      const input = buildInput(prov, [{ productId: product.id, qty: 2 }], {
        discountCode: code.code,
      });

      const results = await Promise.allSettled([
        createOrder(user.id, input, k),
        createOrder(user.id, input, k),
      ]);

      const fulfilled = results.filter(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string }>[];
      expect(fulfilled).toHaveLength(2);
      expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);

      const created = await ordersForUser(user.id);
      created.forEach((o) => fx.remember(o.id));
      expect(created).toHaveLength(1);
      expect(await usageOf(code.id)).toBe(1); // claimed exactly once
    });
  });

  // ── Snapshot survives a later code change ─────────────────────────────────────

  describe('snapshot independence', () => {
    it('deactivating the code after an order leaves the order discount + code untouched', async () => {
      const user = await fx.user();
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 10 });
      const prov = await province(0);
      const code = await makeCode({
        type: DISCOUNT_TYPES.FIXED,
        value: 25_000,
      });

      const order = await createOrder(
        user.id,
        buildInput(prov, [{ productId: product.id, qty: 1 }], {
          discountCode: code.code,
        }),
      );
      fx.remember(order.id);

      await DiscountCodeDao.setActive(code.id, false);

      const [reread] = await testDb
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(reread.discount).toBe(25_000);
      expect(reread.discountCode).toBe(code.code);
    });
  });
});
