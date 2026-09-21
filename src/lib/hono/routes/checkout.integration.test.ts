// Request-level tests for POST /api/checkout, driven through the Hono app the way
// shipping.integration.test.ts does — no handler is called directly, so the body
// schema, requireAuth, the checkout logic, the transaction and the response
// mapping are all exercised together. Only the session lookup is mocked (its own
// coverage is in ../middleware/auth.test.ts); the authorization of THIS endpoint
// is pinned here, as is the mass-assignment gate and the 400-vs-422 split.
//
// Needs a live database — see src/db/test-db.ts.
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discountCodes } from '@/db/schema/discounts';
import { orderItems, orders } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { DISCOUNT_TYPES } from '@/lib/discount/discount-code';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { API_PATHS } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);
const { DiscountCodeDao } = await importWithDb(
  () => import('@/db/dao/DiscountCodeDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

type CheckoutResult = {
  orderId: string;
  orderNo: number;
  status: string;
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
};

describe.skipIf(!databaseReachable)('POST /api/checkout', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];
  const codeIds: string[] = [];

  afterEach(async () => {
    mocks.getSession.mockReset();
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

  const makeCode = async (over: Record<string, unknown> = {}) => {
    const row = await DiscountCodeDao.create({
      code: `SAVE-${token().toUpperCase()}`,
      type: DISCOUNT_TYPES.PERCENT,
      value: 10,
      expiresAt: null,
      usageLimit: null,
      minOrderAmount: 0,
      isActive: true,
      ...over,
    });
    codeIds.push(row.id);
    return row;
  };

  const asUser = (id: string) =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role: 'customer' },
      session: { id: 's1' },
    });

  const province = async (fee = 40_000) => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee,
    });
    provinceIds.push(row.provinceId);
    return row;
  };

  // A valid Idempotency-Key is required, so the helper sends a fresh random UUID
  // by default. Pass `null` to omit the header, or a specific string to drive the
  // missing/invalid-header and replay tests.
  const post = (
    body: unknown,
    idempotencyKey: string | null = crypto.randomUUID(),
  ) =>
    app.request(API_PATHS.CHECKOUT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(idempotencyKey !== null
          ? { 'Idempotency-Key': idempotencyKey }
          : {}),
      },
      body: JSON.stringify(body),
    });

  const body = (
    provinceId: number,
    items: { productId: string; qty: number }[],
    extra: Record<string, unknown> = {},
  ) => ({
    items,
    address: {
      recipientName: 'گیرنده آزمایشی',
      recipientPhone: '09120000000',
      provinceId,
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان آزمایشی، پلاک ۱',
    },
    paymentMethod: PAYMENT_METHODS.COD,
    ...extra,
  });

  it('rejects an unauthenticated request with 401', async () => {
    mocks.getSession.mockResolvedValue(null);
    const prov = await province();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }]),
    );

    expect(response.status).toBe(401);
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('creates a COD order and returns server-authoritative totals', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province(40_000);
    const category = await fx.category();
    const product = await fx.product(category, { price: 150_000, stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 2 }]),
    );
    const payload = (await response.json()) as ApiResponse<CheckoutResult>;

    expect(response.status).toBe(200);
    if (payload.status !== 'success') throw new Error(payload.message);
    const data = payload.data;
    fx.remember(data.orderId);
    expect(data.status).toBe(ORDER_STATUSES.PROCESSING);
    expect(data.subtotal).toBe(300_000);
    expect(data.shippingFee).toBe(40_000);
    expect(data.total).toBe(340_000);

    // Persisted, and owned by the SESSION user.
    const [row] = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, data.orderId));
    expect(row.userId).toBe(user.id);
    expect(row.total).toBe(340_000);
  });

  it('ignores client-smuggled status / userId / total (mass-assignment)', async () => {
    const user = await fx.user();
    const attacker = await fx.user();
    asUser(user.id);
    const prov = await province(40_000);
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }], {
        status: 'delivered',
        userId: attacker.id,
        total: 1,
        subtotal: 1,
        discount: 999,
      }),
    );
    const payload = (await response.json()) as ApiResponse<CheckoutResult>;

    expect(response.status).toBe(200);
    if (payload.status !== 'success') throw new Error(payload.message);
    fx.remember(payload.data.orderId);

    const [row] = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, payload.data.orderId));
    expect(row.userId).toBe(user.id); // session, not the smuggled attacker id
    expect(row.status).toBe(ORDER_STATUSES.PROCESSING); // not 'delivered'
    expect(row.total).toBe(140_000); // server-computed, not 1
    expect(row.discount).toBe(0); // not 999
  });

  it('422s an inactive product, naming the line, reserving nothing', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();
    const category = await fx.category();
    const product = await fx.product(category, { isActive: false, stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }]),
    );
    const payload = (await response.json()) as ApiResponse<unknown>;

    expect(response.status).toBe(422);
    expect(payload.status).toBe('error');
    if (payload.status === 'error') {
      expect(payload.errors?.some((e) => e.startsWith('items.0'))).toBe(true);
    }
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('422s an inactive province with the invalid-province message, pricing nothing', async () => {
    // Deactivated provinces are never priced: `getByProvinceId` hides them, so
    // the existing CheckoutError answers — a 422, never a 500, no order row.
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();
    await ShippingRateDao.setActive(prov.provinceId, false);
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }]),
    );
    const payload = (await response.json()) as ApiResponse<unknown>;

    expect(response.status).toBe(422);
    expect(payload.status === 'error' && payload.errors).toEqual([
      'address.provinceId: استان انتخاب\u200Cشده نامعتبر است.',
    ]);
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('422s an unknown province', async () => {
    const user = await fx.user();
    asUser(user.id);
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(2_147_483_600, [{ productId: product.id, qty: 1 }]),
    );

    expect(response.status).toBe(422);
  });

  it('applies a valid discount code end-to-end and returns the discounted total', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province(40_000);
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock: 5 });
    const code = await makeCode({ type: DISCOUNT_TYPES.PERCENT, value: 10 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 2 }], {
        discountCode: code.code,
      }),
    );
    const payload = (await response.json()) as ApiResponse<CheckoutResult>;

    expect(response.status).toBe(200);
    if (payload.status !== 'success') throw new Error(payload.message);
    fx.remember(payload.data.orderId);
    expect(payload.data.subtotal).toBe(200_000);
    expect(payload.data.discount).toBe(20_000);
    expect(payload.data.total).toBe(200_000 - 20_000 + 40_000);
  });

  it('422s an unknown discount code, naming the field', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }], {
        discountCode: 'NO-SUCH-CODE',
      }),
    );
    const payload = (await response.json()) as ApiResponse<unknown>;

    expect(response.status).toBe(422);
    if (payload.status === 'error') {
      expect(payload.errors?.some((e) => e.startsWith('discountCode'))).toBe(
        true,
      );
    }
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('400s a malformed body (non-uuid productId) before touching the DB', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();

    const response = await post(
      body(prov.provinceId, [{ productId: 'not-a-uuid', qty: 1 }]),
    );

    expect(response.status).toBe(400);
  });

  it('400s when the Idempotency-Key header is missing', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }]),
      null, // no header
    );

    expect(response.status).toBe(400);
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('400s when the Idempotency-Key header is not a uuid', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post(
      body(prov.provinceId, [{ productId: product.id, qty: 1 }]),
      'not-a-uuid',
    );

    expect(response.status).toBe(400);
    expect(await ordersFor(product.id)).toBe(0);
  });

  it('is idempotent — a replay with the same key returns the same order, reserving once', async () => {
    const user = await fx.user();
    asUser(user.id);
    const prov = await province(40_000);
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock: 5 });
    const key = crypto.randomUUID();
    const payload = body(prov.provinceId, [{ productId: product.id, qty: 2 }]);

    const first = await post(payload, key);
    const firstBody = (await first.json()) as ApiResponse<CheckoutResult>;
    expect(first.status).toBe(200);
    if (firstBody.status !== 'success') throw new Error(firstBody.message);
    fx.remember(firstBody.data.orderId);

    // Same key, same everything — a double-submit or a resend.
    const second = await post(payload, key);
    const secondBody = (await second.json()) as ApiResponse<CheckoutResult>;
    expect(second.status).toBe(200);
    if (secondBody.status !== 'success') throw new Error(secondBody.message);

    // The SAME order, and the stock decremented exactly once (5 - 2 = 3).
    expect(secondBody.data.orderId).toBe(firstBody.data.orderId);
    expect(await ordersFor(product.id)).toBe(1);
    const [row] = await testDb
      .select({ stock: productsTable.stock })
      .from(productsTable)
      .where(eq(productsTable.id, product.id));
    expect(row.stock).toBe(3);
  });

  it('400s a body missing the address', async () => {
    const user = await fx.user();
    asUser(user.id);
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });

    const response = await post({
      items: [{ productId: product.id, qty: 1 }],
      paymentMethod: PAYMENT_METHODS.COD,
      // no address
    });

    expect(response.status).toBe(400);
    expect(await ordersFor(product.id)).toBe(0);
  });

  // ── Discount preview (read-only; no order, no usage claim) ─────────────────────

  describe('POST /api/checkout/preview', () => {
    const preview = (payload: unknown) =>
      app.request(API_PATHS.CHECKOUT_PREVIEW, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

    it('rejects an unauthenticated request with 401 (the exact-path guard)', async () => {
      // The regression the advisor flagged: `/checkout` is an exact-path mount, so
      // `/checkout/preview` needs its own requireAuth or it is an anonymous
      // code-enumeration oracle.
      mocks.getSession.mockResolvedValue(null);
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });
      const code = await makeCode();

      const response = await preview({
        items: [{ productId: product.id, qty: 1 }],
        discountCode: code.code,
      });
      expect(response.status).toBe(401);
    });

    it('returns the server-computed subtotal and discount for a valid code (no usage claim)', async () => {
      const user = await fx.user();
      asUser(user.id);
      const category = await fx.category();
      const product = await fx.product(category, { price: 100_000, stock: 5 });
      const code = await makeCode({ type: DISCOUNT_TYPES.PERCENT, value: 10 });

      const response = await preview({
        items: [{ productId: product.id, qty: 2 }],
        discountCode: code.code,
      });
      const payload = (await response.json()) as ApiResponse<{
        subtotal: number;
        discount: number;
      }>;

      expect(response.status).toBe(200);
      if (payload.status !== 'success') throw new Error(payload.message);
      expect(payload.data.subtotal).toBe(200_000);
      expect(payload.data.discount).toBe(20_000);

      // Advisory only: the preview must NOT consume a use.
      const [row] = await testDb
        .select({ usageCount: discountCodes.usageCount })
        .from(discountCodes)
        .where(eq(discountCodes.id, code.id));
      expect(row.usageCount).toBe(0);
    });

    it('422s a bad code, naming the discountCode field', async () => {
      const user = await fx.user();
      asUser(user.id);
      const category = await fx.category();
      const product = await fx.product(category, { stock: 5 });

      const response = await preview({
        items: [{ productId: product.id, qty: 1 }],
        discountCode: 'NO-SUCH-CODE',
      });
      const payload = (await response.json()) as ApiResponse<unknown>;

      expect(response.status).toBe(422);
      if (payload.status === 'error') {
        expect(payload.errors?.some((e) => e.startsWith('discountCode'))).toBe(
          true,
        );
      }
    });
  });

  /** How many order lines reference this product — 0 when a checkout rolled back. */
  const ordersFor = async (productId: string) => {
    const rows = await testDb
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(eq(orderItems.productId, productId));
    return rows.length;
  };
});
