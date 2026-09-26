// Request-level tests for the admin order API, driven through the real Hono `app`
// — so they prove the mount order in ../index.ts (the `/admin/*` guard runs before
// every handler) and the whole read/transition path, not a handler in isolation.
// Only the session lookup is mocked.
//
// Three things carry the weight:
//   · the authz matrix — 401 anon, 403 customer, on every verb;
//   · the admin projection — authority/refId/method/amount reach the admin, the
//     raw `gatewayResponse` never does;
//   · the full 7×7 transition matrix — every legal admin edge succeeds and every
//     other pair is refused SERVER-SIDE, including `pending_payment → paid/failed`
//     (a legal machine edge the admin must not be able to trigger).
import { eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PET_TYPES, categories, products } from '@/db/schema/catalog';
import { users } from '@/db/schema/auth';
import { orders } from '@/db/schema/orders';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { API_PATHS, apiAdminOrderTransitionsPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import {
  adminNextStatuses,
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

const asAdmin = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', role: 'admin' },
    session: { id: 's1' },
  });
const asCustomer = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'cust-1', role: 'customer' },
    session: { id: 's2' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

const adminOrderPath = (id: string) => `${API_PATHS.ADMIN_ORDERS}/${id}`;

describe.skipIf(!databaseReachable)('admin order API', () => {
  // Shared setup — one user/category/product backs every seeded order, so the
  // matrix is ~49 order inserts, not 49 of everything. Torn down once at the end.
  const createdUserIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  let productId: string;

  beforeAll(async () => {
    const [user] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: 'مشتری',
        email: `o-${crypto.randomUUID()}@x.test`,
      })
      .returning();
    createdUserIds.push(user.id);
    const [category] = await testDb
      .insert(categories)
      .values({ title: 'دسته', slug: `ao-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    createdCategoryIds.push(category.id);
    const [product] = await testDb
      .insert(products)
      .values({
        title: 'محصول',
        slug: `ao-${crypto.randomUUID().slice(0, 8)}`,
        sku: `AO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        price: 100_000,
        stock: 1000,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      })
      .returning();
    createdProductIds.push(product.id);
    productId = product.id;
  });

  afterEach(() => mocks.getSession.mockReset());

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await testDb.delete(orders).where(inArray(orders.id, createdOrderIds));
    }
    if (createdProductIds.length > 0) {
      await testDb
        .delete(products)
        .where(inArray(products.id, createdProductIds));
    }
    if (createdCategoryIds.length > 0) {
      await testDb
        .delete(categories)
        .where(inArray(categories.id, createdCategoryIds));
    }
    if (createdUserIds.length > 0) {
      await testDb.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  const json = (path: string, method: string, b?: unknown) =>
    app.request(path, {
      method,
      ...(b === undefined
        ? {}
        : {
            body: JSON.stringify(b),
            headers: { 'content-type': 'application/json' },
          }),
    });

  const parse = async <T>(res: Response) => ({
    status: res.status,
    body: (await res.json()) as ApiResponse<T>,
  });

  /** Seed one Zarinpal order directly in `status` (no walking the machine). */
  const seedOrder = async (
    status: OrderStatus,
    method = PAYMENT_METHODS.ZARINPAL,
  ) => {
    const order = await OrderDao.create({
      userId: createdUserIds[0],
      status,
      paymentMethod: method,
      subtotal: 100_000,
      shippingFee: 50_000,
      total: 150_000,
      provinceName: 'تهران',
      recipientName: 'گیرنده آزمایشی',
      recipientPhone: '+989120000000',
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان آزمایشی، پلاک ۱',
      items: [
        { productId, title: 'محصول', sku: 'AO-1', unitPrice: 100_000, qty: 1 },
      ],
    });
    createdOrderIds.push(order.id);
    return order;
  };

  // ── Authorization ───────────────────────────────────────────────────────────

  describe('authorization', () => {
    it('answers 401 without a session on read and transition', async () => {
      anon();
      const id = crypto.randomUUID();
      const calls = await Promise.all([
        json(adminOrderPath(id), 'GET'),
        json(apiAdminOrderTransitionsPath(id), 'POST', {
          to: ORDER_STATUSES.PROCESSING,
        }),
      ]);
      expect(calls.map((c) => c.status)).toEqual([401, 401]);
    });

    it('answers 403 to a signed-in customer on read and transition', async () => {
      asCustomer();
      const id = crypto.randomUUID();
      const calls = await Promise.all([
        json(adminOrderPath(id), 'GET'),
        json(apiAdminOrderTransitionsPath(id), 'POST', {
          to: ORDER_STATUSES.PROCESSING,
        }),
      ]);
      expect(calls.map((c) => c.status)).toEqual([403, 403]);
    });

    it('refuses before parsing — a customer POSTing junk still gets 403', async () => {
      asCustomer();
      const res = await json(
        apiAdminOrderTransitionsPath(crypto.randomUUID()),
        'POST',
        { to: 'not-a-status' },
      );
      expect(res.status).toBe(403);
    });
  });

  // ── Detail read + admin projection ──────────────────────────────────────────

  describe('GET /admin/orders/{id}', () => {
    it.each([
      [true, true],
      [false, false],
      [undefined, false],
      ['true', false],
      [1, false],
      [null, false],
    ])(
      'projects only the boolean refund flag (%s), never gatewayResponse',
      async (flag, expected) => {
        const order = await seedOrder(ORDER_STATUSES.PAID);
        await PaymentDao.create({
          orderId: order.id,
          method: PAYMENT_METHODS.ZARINPAL,
          status: PAYMENT_STATUSES.PAID,
          amount: order.total,
          authority: `AUTH-${order.id}`,
          refId: 'REF-123',
          cardPan: '6037********1234',
          gatewayResponse: {
            secret: 'SECRET_BLOB_MARKER',
            pan: 'raw',
            needsManualRefund: flag,
          },
          paidAt: new Date(),
        });

        asAdmin();
        const { status, body } = await parse<{
          status: string;
          payments: {
            method: string;
            status: string;
            amount: number;
            authority: string | null;
            refId: string | null;
            cardPan: string | null;
            needsManualRefund: boolean;
          }[];
        }>(await json(adminOrderPath(order.id), 'GET'));

        expect(status).toBe(200);
        if (body.status !== 'success') throw new Error(body.message);
        const payment = body.data.payments[0];
        // The admin sees more than a customer does…
        expect(payment.authority).toBe(`AUTH-${order.id}`);
        expect(payment.refId).toBe('REF-123');
        expect(payment.method).toBe(PAYMENT_METHODS.ZARINPAL);
        expect(payment.amount).toBe(order.total);
        expect(payment.cardPan).toBe('6037********1234');
        expect(payment.needsManualRefund).toBe(expected);

        // …but the raw gateway blob is not in the response at all.
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('gatewayResponse');
        expect(raw).not.toContain('SECRET_BLOB_MARKER');
      },
    );

    it('404s an unknown id and 400s a malformed id', async () => {
      asAdmin();
      const missing = await json(adminOrderPath(crypto.randomUUID()), 'GET');
      expect(missing.status).toBe(404);
      const malformed = await json(`/api/admin/orders/not-a-uuid`, 'GET');
      expect(malformed.status).toBe(400);
    });
  });

  // ── Transition matrix ────────────────────────────────────────────────────────

  describe('POST /admin/orders/{id}/transitions', () => {
    const pairs = ORDER_STATUS_VALUES.flatMap((from) =>
      ORDER_STATUS_VALUES.map((to) => [from, to] as const),
    );

    it('covers all 49 ordered (from, to) pairs', () => {
      expect(pairs).toHaveLength(49);
    });

    it.each(pairs)(
      'from %s to %s: 200 iff it is an admin-legal edge, else 400',
      async (from, to) => {
        const order = await seedOrder(from);
        asAdmin();
        const res = await json(apiAdminOrderTransitionsPath(order.id), 'POST', {
          to,
        });
        const legal = adminNextStatuses(from).includes(to);
        expect(res.status).toBe(legal ? 200 : 400);
        if (legal) {
          const after = await testDb
            .select({ status: orders.status })
            .from(orders)
            .where(eq(orders.id, order.id))
            .limit(1);
          expect(after[0].status).toBe(to);
        }
      },
    );

    it('rejects the gateway-owned targets from pending_payment (400, row untouched)', async () => {
      for (const to of [ORDER_STATUSES.PAID, ORDER_STATUSES.FAILED]) {
        const order = await seedOrder(ORDER_STATUSES.PENDING_PAYMENT);
        asAdmin();
        const res = await json(apiAdminOrderTransitionsPath(order.id), 'POST', {
          to,
        });
        expect(res.status).toBe(400);
        const [row] = await testDb
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, order.id))
          .limit(1);
        expect(row.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      }
    });

    it('returns the updated admin projection on success, still without gatewayResponse', async () => {
      const order = await seedOrder(ORDER_STATUSES.PAID);
      await PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.ZARINPAL,
        status: PAYMENT_STATUSES.PAID,
        amount: order.total,
        authority: 'AUTH-OK',
        refId: 'REF-OK',
        gatewayResponse: { secret: 'SECRET_BLOB_MARKER' },
        paidAt: new Date(),
      });
      asAdmin();
      const { status, body } = await parse<{ status: string }>(
        await json(apiAdminOrderTransitionsPath(order.id), 'POST', {
          to: ORDER_STATUSES.PROCESSING,
        }),
      );
      expect(status).toBe(200);
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data.status).toBe(ORDER_STATUSES.PROCESSING);
      expect(JSON.stringify(body)).not.toContain('SECRET_BLOB_MARKER');
    });

    it('400s a malformed target status', async () => {
      const order = await seedOrder(ORDER_STATUSES.PAID);
      asAdmin();
      const res = await json(apiAdminOrderTransitionsPath(order.id), 'POST', {
        to: 'nonsense',
      });
      expect(res.status).toBe(400);
    });

    it('404s a transition on an unknown order', async () => {
      asAdmin();
      const res = await json(
        apiAdminOrderTransitionsPath(crypto.randomUUID()),
        'POST',
        { to: ORDER_STATUSES.PROCESSING },
      );
      expect(res.status).toBe(404);
    });
  });
});
