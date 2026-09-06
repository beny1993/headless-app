// Request-level tests for the admin discount API, driven through the real Hono
// `app` — so what they prove is the mount order in ../index.ts (the guard runs
// before every admin handler) and the whole create/toggle path, not a handler in
// isolation. Only the session lookup is mocked.
//
// The authz matrix is the point (401 no session, 403 customer, success for admin),
// plus the mass-assignment gate: a create body carrying `usageCount`/`id` must not
// bypass the limit or pin the id — the security pass probes exactly this.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discountCodes } from '@/db/schema/discounts';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { API_PATHS, apiAdminDiscountPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { DiscountCodeDao } = await importWithDb(
  () => import('@/db/dao/DiscountCodeDao'),
);

const asAdmin = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', email: 'a@example.com', role: 'admin' },
    session: { id: 's1' },
  });
const asCustomer = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'cust-1', email: 'c@example.com', role: 'customer' },
    session: { id: 's2' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

describe.skipIf(!databaseReachable)('admin discount API', () => {
  const codeIds: string[] = [];

  const body = (over: Record<string, unknown> = {}) => ({
    code: `SAVE-${faker.string.alphanumeric(8).toUpperCase()}`,
    type: 'percent',
    value: 10,
    expiresAt: null,
    usageLimit: null,
    minOrderAmount: 0,
    isActive: true,
    ...over,
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

  afterEach(async () => {
    mocks.getSession.mockReset();
    if (codeIds.length > 0) {
      await testDb
        .delete(discountCodes)
        .where(inArray(discountCodes.id, codeIds));
      codeIds.length = 0;
    }
  });

  // ── Authz matrix ──────────────────────────────────────────────────────────────

  describe('authorization', () => {
    it('answers 401 without a session on every admin route', async () => {
      anon();
      const someId = faker.string.uuid();
      const calls = await Promise.all([
        json(API_PATHS.ADMIN_DISCOUNTS, 'POST', {}),
        json(apiAdminDiscountPath(someId), 'PATCH', {}),
      ]);
      expect(calls.map((c) => c.status)).toEqual([401, 401]);
    });

    it('answers 403 to a signed-in customer on every admin route', async () => {
      asCustomer();
      const someId = faker.string.uuid();
      const calls = await Promise.all([
        json(API_PATHS.ADMIN_DISCOUNTS, 'POST', {}),
        json(apiAdminDiscountPath(someId), 'PATCH', {}),
      ]);
      expect(calls.map((c) => c.status)).toEqual([403, 403]);
    });

    it('refuses before it parses the body — a customer POSTing junk still gets 403', async () => {
      asCustomer();
      const res = await json(API_PATHS.ADMIN_DISCOUNTS, 'POST', {
        value: 'not-a-number',
      });
      expect(res.status).toBe(403);
    });
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('POST /admin/discounts', () => {
    it('creates a code and returns it (201), normalizing the code', async () => {
      asAdmin();
      const { status, body: envelope } = await parse<{
        id: string;
        code: string;
        usageCount: number;
      }>(
        await json(
          API_PATHS.ADMIN_DISCOUNTS,
          'POST',
          body({ code: 'newyear' }),
        ),
      );

      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      codeIds.push(envelope.data.id);
      expect(envelope.data.code).toBe('NEWYEAR');
      expect(envelope.data.usageCount).toBe(0);
    });

    it('creates a fixed code', async () => {
      asAdmin();
      const { status, body: envelope } = await parse<{
        id: string;
        type: string;
        value: number;
      }>(
        await json(
          API_PATHS.ADMIN_DISCOUNTS,
          'POST',
          body({ type: 'fixed', value: 50_000 }),
        ),
      );
      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      codeIds.push(envelope.data.id);
      expect(envelope.data.type).toBe('fixed');
      expect(envelope.data.value).toBe(50_000);
    });

    it('400s a duplicate code with a field-scoped error', async () => {
      asAdmin();
      const first = body({ code: 'DUPE' });
      const created = await parse<{ id: string }>(
        await json(API_PATHS.ADMIN_DISCOUNTS, 'POST', first),
      );
      if (created.body.status === 'success') codeIds.push(created.body.data.id);

      const { status, body: envelope } = await parse(
        await json(API_PATHS.ADMIN_DISCOUNTS, 'POST', body({ code: 'dupe' })),
      );
      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected error');
      expect(envelope.errors?.some((e) => e.startsWith('code:'))).toBe(true);
    });

    it('400s a percent value out of range from the validator', async () => {
      asAdmin();
      const res = await json(
        API_PATHS.ADMIN_DISCOUNTS,
        'POST',
        body({ type: 'percent', value: 0 }),
      );
      expect(res.status).toBe(400);
    });

    it('is mass-assignment safe: a body with usageCount and id is stripped', async () => {
      asAdmin();
      const { status, body: envelope } = await parse<{
        id: string;
        usageCount: number;
      }>(
        await json(
          API_PATHS.ADMIN_DISCOUNTS,
          'POST',
          body({
            code: 'MASSASSIGN',
            usageCount: 999,
            id: '00000000-0000-0000-0000-000000000000',
          }),
        ),
      );
      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      codeIds.push(envelope.data.id);
      // Server-owned: the smuggled usageCount and id never took effect.
      expect(envelope.data.usageCount).toBe(0);
      expect(envelope.data.id).not.toBe('00000000-0000-0000-0000-000000000000');

      // And the row in the DB agrees.
      const [row] = await testDb
        .select()
        .from(discountCodes)
        .where(eq(discountCodes.id, envelope.data.id));
      expect(row.usageCount).toBe(0);
    });
  });

  // ── Toggle ────────────────────────────────────────────────────────────────────

  describe('PATCH /admin/discounts/{id}', () => {
    it('deactivates then reactivates a code (200)', async () => {
      const created = await DiscountCodeDao.create({
        code: `TOG-${faker.string.alphanumeric(6).toUpperCase()}`,
        type: 'percent',
        value: 10,
        expiresAt: null,
        usageLimit: null,
        minOrderAmount: 0,
        isActive: true,
      });
      codeIds.push(created.id);

      asAdmin();
      const off = await parse<{ isActive: boolean }>(
        await json(apiAdminDiscountPath(created.id), 'PATCH', {
          isActive: false,
        }),
      );
      expect(off.status).toBe(200);
      if (off.body.status !== 'success') throw new Error('expected success');
      expect(off.body.data.isActive).toBe(false);

      const on = await parse<{ isActive: boolean }>(
        await json(apiAdminDiscountPath(created.id), 'PATCH', {
          isActive: true,
        }),
      );
      if (on.body.status !== 'success') throw new Error('expected success');
      expect(on.body.data.isActive).toBe(true);
    });

    it('404s an unknown id', async () => {
      asAdmin();
      const res = await json(
        apiAdminDiscountPath(faker.string.uuid()),
        'PATCH',
        {
          isActive: false,
        },
      );
      expect(res.status).toBe(404);
    });

    it('400s a body missing isActive (no partial field edits)', async () => {
      asAdmin();
      const res = await json(
        apiAdminDiscountPath(faker.string.uuid()),
        'PATCH',
        {
          value: 99,
        },
      );
      expect(res.status).toBe(400);
    });
  });
});
