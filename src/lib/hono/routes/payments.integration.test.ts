// Request-level tests for the Zarinpal endpoints, driven through the Hono app the
// way checkout.integration.test.ts is — only the session lookup is mocked, so the
// guards (requireAuth / requireAdmin), the zod validation, the settle logic and
// the redirect wiring are all exercised together. The callback's DELIBERATE lack
// of auth is pinned here (a completed payment must settle with no session).
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
import {
  API_PATHS,
  checkoutFailurePath,
  checkoutResultPath,
} from '@/lib/constant/paths';
import { mockLedger } from '@/lib/zarinpal/client';
import type { ApiResponse } from '@/lib/hono/envelope';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('Zarinpal payment routes', () => {
  const fx = new OrderFixtures();
  afterEach(async () => {
    mocks.getSession.mockReset();
    await fx.cleanup();
    mockLedger.reset();
  });

  const asUser = (id: string, role = 'customer') =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role },
      session: { id: 's1' },
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

  const pendingAttempt = async (orderId: string, amount = 340_000) =>
    PaymentDao.create({
      orderId,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount,
      authority: `A-${crypto.randomUUID()}`,
    });

  const orderStatus = async (id: string) =>
    (await testDb.select().from(orders).where(eq(orders.id, id)))[0].status;
  const paymentRow = async (id: string) =>
    (await testDb.select().from(payments).where(eq(payments.id, id)))[0];

  // ── POST /request ──────────────────────────────────────────────────────────

  it('request: 401 without a session', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { order } = await zarinpalOrder();

    const res = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });

    expect(res.status).toBe(401);
  });

  it('request: 200 with a redirect URL for the owner', async () => {
    const { user, order } = await zarinpalOrder();
    asUser(user.id);

    const res = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });
    const payload = (await res.json()) as ApiResponse<{ redirectUrl: string }>;

    expect(res.status).toBe(200);
    if (payload.status !== 'success') throw new Error(payload.message);
    expect(payload.data.redirectUrl).toContain('/mock-gateway');
  });

  it('request: 404 for another user’s order (IDOR)', async () => {
    const { order } = await zarinpalOrder();
    const attacker = await fx.user();
    asUser(attacker.id);

    const res = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });

    expect(res.status).toBe(404);
  });

  it('request: 422 for a COD order', async () => {
    const { user, order } = await zarinpalOrder({
      paymentMethod: PAYMENT_METHODS.COD,
    });
    asUser(user.id);

    const res = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });

    expect(res.status).toBe(422);
  });

  it('request: 400 for a non-uuid orderId', async () => {
    const user = await fx.user();
    asUser(user.id);

    const res = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
  });

  // ── GET /callback (unauthenticated) ─────────────────────────────────────────

  const callback = (authority: string, status: string) =>
    app.request(
      `${API_PATHS.PAYMENT_CALLBACK}?Authority=${encodeURIComponent(
        authority,
      )}&Status=${status}`,
    );

  it('callback OK settles the order paid WITH NO SESSION (deliberate un-auth)', async () => {
    mocks.getSession.mockResolvedValue(null); // no session at all
    const { order } = await zarinpalOrder();
    const attempt = await pendingAttempt(order.id);
    mockLedger.markPaid(attempt.authority!, 340_000);

    const res = await callback(attempt.authority!, 'OK');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(checkoutResultPath(order.id));
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
    expect((await paymentRow(attempt.id)).status).toBe(PAYMENT_STATUSES.PAID);
  });

  it('callback NOK fails the attempt, order stays pending, redirects to result', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { order } = await zarinpalOrder();
    const attempt = await pendingAttempt(order.id);

    const res = await callback(attempt.authority!, 'NOK');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(checkoutResultPath(order.id));
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    expect((await paymentRow(attempt.id)).status).toBe(PAYMENT_STATUSES.FAILED);
  });

  it('callback with an unknown authority redirects to the failure page, no settle', async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await callback(`A-${crypto.randomUUID()}`, 'OK');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(checkoutFailurePath());
  });

  it('callback with a malformed query redirects to the failure page, no write', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { order } = await zarinpalOrder();
    const attempt = await pendingAttempt(order.id);

    // Missing Status — not a valid callback.
    const res = await app.request(
      `${API_PATHS.PAYMENT_CALLBACK}?Authority=${encodeURIComponent(attempt.authority!)}`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(checkoutFailurePath());
    // The pending attempt was never touched.
    expect((await paymentRow(attempt.id)).status).toBe(
      PAYMENT_STATUSES.PENDING,
    );
  });

  // ── POST /reconcile (admin) ─────────────────────────────────────────────────

  it('reconcile: 401 without a session', async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await app.request(API_PATHS.PAYMENT_RECONCILE, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('reconcile: 403 for a non-admin session', async () => {
    const user = await fx.user();
    asUser(user.id, 'customer');
    const res = await app.request(API_PATHS.PAYMENT_RECONCILE, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });

  it('reconcile: 200 for an admin session', async () => {
    const admin = await fx.user();
    asUser(admin.id, 'admin');
    const res = await app.request(API_PATHS.PAYMENT_RECONCILE, {
      method: 'POST',
    });
    const payload = (await res.json()) as ApiResponse<{ verified: number }>;

    expect(res.status).toBe(200);
    expect(payload.status).toBe('success');
  });

  // ── Full mock-gateway walkthrough ───────────────────────────────────────────

  it('mock gateway: request → gateway page → pay → callback settles the order', async () => {
    const { user, order } = await zarinpalOrder();
    asUser(user.id);

    // 1. Start the payment.
    const reqRes = await app.request(API_PATHS.PAYMENT_REQUEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });
    expect(reqRes.status).toBe(200);
    const [attempt] = await PaymentDao.listByOrder(order.id);
    const authority = attempt.authority!;

    // 2. The dev-only gateway page renders (mock provider) with the Pay button.
    const pageRes = await app.request(
      `${API_PATHS.PAYMENT_MOCK_GATEWAY}?authority=${encodeURIComponent(authority)}`,
    );
    expect(pageRes.status).toBe(200);
    expect(await pageRes.text()).toContain('پرداخت موفق');

    // 3. Click Pay → 302 back to the callback with Status=OK.
    const completeRes = await app.request(API_PATHS.PAYMENT_MOCK_COMPLETE, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ authority, action: 'pay' }).toString(),
    });
    expect(completeRes.status).toBe(302);
    const callbackUrl = completeRes.headers.get('location')!;
    expect(callbackUrl).toContain('Status=OK');

    // 4. Follow the callback → order settles paid.
    const cbRes = await app.request(callbackUrl);
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(checkoutResultPath(order.id));
    expect(await orderStatus(order.id)).toBe(ORDER_STATUSES.PAID);
  });

  it('mock gateway + mock-complete 404 when the provider is not mock', async () => {
    // The dev-only pages must not exist on a real (provider=zarinpal) deployment —
    // the gate is on the provider, not NODE_ENV. getZarinpalProvider only checks
    // the name is known, so no merchant id is needed to flip it here.
    vi.stubEnv('APP_CONFIG_ZARINPAL_PROVIDER', 'zarinpal');
    try {
      const gw = await app.request(
        `${API_PATHS.PAYMENT_MOCK_GATEWAY}?authority=whatever`,
      );
      expect(gw.status).toBe(404);

      const complete = await app.request(API_PATHS.PAYMENT_MOCK_COMPLETE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ authority: 'x', action: 'pay' }).toString(),
      });
      expect(complete.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('mock gateway HTML-escapes the authority — no attribute-breakout XSS', async () => {
    // Authorities are server-minted so this is defense-in-depth, but a value
    // interpolated into the hidden-input attribute must never break out of it.
    const { order } = await zarinpalOrder();
    const evil = `mock-${crypto.randomUUID()}"><script>alert(1)</script>`;
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: 340_000,
      authority: evil,
    });

    const res = await app.request(
      `${API_PATHS.PAYMENT_MOCK_GATEWAY}?authority=${encodeURIComponent(evil)}`,
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
