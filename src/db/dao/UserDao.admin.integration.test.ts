// The admin users list and detail reads on UserDao. Needs a live Postgres
// (src/db/test-db.ts), because what these prove is SQL a mocked `db` cannot
// check:
//   · the per-row order count and total spent are correlated subqueries bound
//     to the right row (an unqualified `id` inside `from orders` would read 0
//     for everyone), and total spent follows the dashboard's revenue rule;
//   · every search shape: an exact phone in any spelling, a `0…` prefix, a
//     case-insensitive name fragment with `%` and `_` taken literally;
//   · the customers-only counts and the Jalali month boundary in Tehran time.
//
// The users table is shared with every other suite and with QA, so searches
// are narrowed to a per-run token and the counts are baseline-delta.
import { and, eq, gte, notInArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ROLES, users, type Role } from '@/db/schema/auth';
import { jalaliMonthStart } from '@/lib/format';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';

const { UserDao } = await importWithDb(() => import('@/db/dao/UserDao'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

const token = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
/** Seven random digits: the tail of a test phone number. */
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

const MINUTE = 60_000;

describe.skipIf(!databaseReachable)('UserDao admin reads', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** A user with the fields these tests steer; removed by `fx.cleanup`. */
  const makeUser = async (fields: {
    name?: string;
    phoneNumber?: string | null;
    role?: Role;
    createdAt?: Date;
  }) => {
    const [row] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `test-${token()}@example.com`,
        name: fields.name ?? '',
        phoneNumber: fields.phoneNumber ?? null,
        role: fields.role ?? ROLES.CUSTOMER,
        ...(fields.createdAt && { createdAt: fields.createdAt }),
      })
      .returning();
    fx.userIds.push(row.id);
    return row;
  };

  /** One order for `user` in a status, with one payment attempt in a state. */
  const makeOrder = async (
    user: Awaited<ReturnType<typeof makeUser>>,
    status: OrderStatus,
    payment: PaymentStatus,
    unitPrice: number,
  ) => {
    const product = await fx.product(await fx.category());
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, unitPrice }], {
        status,
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      }),
    );
    fx.remember(order.id);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: payment,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
      paidAt: payment === PAYMENT_STATUSES.PAID ? new Date() : null,
    });
    return order;
  };

  describe('pageForAdmin', () => {
    it('pages newest first and counts the whole match', async () => {
      const t = token();
      const base = Date.now() - 60 * MINUTE;
      const [oldest, middle, newest] = [
        await makeUser({ name: `t${t} a`, createdAt: new Date(base) }),
        await makeUser({ name: `t${t} b`, createdAt: new Date(base + 1000) }),
        await makeUser({ name: `t${t} c`, createdAt: new Date(base + 2000) }),
      ];

      const first = await UserDao.pageForAdmin({
        search: t,
        page: 1,
        limit: 2,
      });
      const second = await UserDao.pageForAdmin({
        search: t,
        page: 2,
        limit: 2,
      });

      expect(first.total).toBe(3);
      expect(first.items.map((row) => row.id)).toEqual([newest.id, middle.id]);
      expect(second.items.map((row) => row.id)).toEqual([oldest.id]);
    });

    it('lists admins as well as customers, and never the email', async () => {
      const t = token();
      const admin = await makeUser({ name: `t${t}`, role: ROLES.ADMIN });
      const customer = await makeUser({ name: `t${t}` });

      const { items } = await UserDao.pageForAdmin({ search: t });

      expect(items.map((row) => [row.id, row.role])).toEqual([
        [customer.id, ROLES.CUSTOMER],
        [admin.id, ROLES.ADMIN],
      ]);
      for (const row of items) expect(row).not.toHaveProperty('email');
    });

    it('lists every user with no search', async () => {
      const user = await makeUser({});
      const { items, total } = await UserDao.pageForAdmin({
        limit: ADMIN_PAGE_SIZE,
      });

      // Newest first, so the user just made is on the first page. Not
      // necessarily row one: the table is shared, and someone may sign in on
      // the dev database mid-run.
      expect(items.map((row) => row.id)).toContain(user.id);
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('order count and total spent', () => {
    it('counts every order, and sums only paid, booked ones', async () => {
      const t = token();
      const buyer = await makeUser({ name: `t${t} buyer` });
      const browser = await makeUser({ name: `t${t} browser` });
      const paid = await makeOrder(
        buyer,
        ORDER_STATUSES.PAID,
        PAYMENT_STATUSES.PAID,
        1_110_000,
      );
      // Not revenue: unpaid, refunded (cancelled after paying), or a status
      // that says paid over an attempt that failed.
      await makeOrder(
        buyer,
        ORDER_STATUSES.PENDING_PAYMENT,
        PAYMENT_STATUSES.PENDING,
        2_220_000,
      );
      await makeOrder(
        buyer,
        ORDER_STATUSES.CANCELLED,
        PAYMENT_STATUSES.PAID,
        3_330_000,
      );
      await makeOrder(
        buyer,
        ORDER_STATUSES.PAID,
        PAYMENT_STATUSES.FAILED,
        4_440_000,
      );

      const { items } = await UserDao.pageForAdmin({ search: `t${t}` });
      const row = (id: string) => items.find((item) => item.id === id);

      expect(row(buyer.id)).toMatchObject({
        orderCount: 4,
        totalSpent: paid.total,
      });
      expect(row(browser.id)).toMatchObject({ orderCount: 0, totalSpent: 0 });

      expect(await UserDao.findForAdmin(buyer.id)).toMatchObject({
        orderCount: 4,
        totalSpent: paid.total,
      });
    });
  });

  describe('search', () => {
    it.each([
      ['the local form', (national: string) => `0${national}`],
      ['the canonical form', (national: string) => `+98${national}`],
      ['the 0098 form', (national: string) => `0098${national}`],
      [
        'Persian digits',
        (national: string) =>
          `0${national}`.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]),
      ],
    ])('finds a full phone written in %s', async (_label, spell) => {
      const national = `9${digits(9)}`;
      const user = await makeUser({ phoneNumber: `+98${national}` });

      const { items, total } = await UserDao.pageForAdmin({
        search: spell(national),
      });

      expect(total).toBe(1);
      expect(items.map((row) => row.id)).toEqual([user.id]);
    });

    it('finds a partial local phone by prefix, not by substring', async () => {
      const block = `9${digits(5)}`;
      const a = await makeUser({ phoneNumber: `+98${block}${digits(4)}` });
      const b = await makeUser({ phoneNumber: `+98${block}${digits(4)}` });
      // Holds the block in the middle of the number, never at its start.
      const inside = await makeUser({ phoneNumber: `+98999${block}${'0'}` });

      const { items } = await UserDao.pageForAdmin({
        search: `0${block}`,
        limit: 100,
      });
      const ids = items.map((row) => row.id);

      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(ids).not.toContain(inside.id);
      for (const row of items) {
        expect(row.phoneNumber?.startsWith(`+98${block}`)).toBe(true);
      }
    });

    it('does not read a partial without the leading 0 as a phone', async () => {
      const block = `9${digits(5)}`;
      await makeUser({ phoneNumber: `+98${block}${digits(4)}` });

      const { items } = await UserDao.pageForAdmin({ search: block });

      expect(items).toEqual([]);
    });

    it('finds a name fragment regardless of Latin case', async () => {
      const t = token();
      const latin = await makeUser({ name: `Sara ZETA${t.toUpperCase()}` });
      const persian = await makeUser({ name: `سارا محمدی ${t}` });

      const byLatin = await UserDao.pageForAdmin({ search: `zeta${t}` });
      const byPersian = await UserDao.pageForAdmin({ search: `محمدی ${t}` });

      expect(byLatin.items.map((row) => row.id)).toEqual([latin.id]);
      expect(byPersian.items.map((row) => row.id)).toEqual([persian.id]);
    });

    it('matches % _ and \\ as the characters themselves', async () => {
      const t = token();
      const percent = await makeUser({ name: `n${t}a%b` });
      const underscore = await makeUser({ name: `n${t}a_b` });
      const backslash = await makeUser({ name: `n${t}a\\b` });
      await makeUser({ name: `n${t}axb` });

      const found = async (search: string) =>
        (await UserDao.pageForAdmin({ search })).items.map((row) => row.id);

      expect(await found(`${t}a%b`)).toEqual([percent.id]);
      expect(await found(`${t}a_b`)).toEqual([underscore.id]);
      expect(await found(`${t}a\\b`)).toEqual([backslash.id]);
    });
  });

  describe('findForAdmin', () => {
    it('reads one user by id, without the email, or null', async () => {
      const user = await makeUser({ name: 'مشتری', phoneNumber: null });

      const found = await UserDao.findForAdmin(user.id);

      expect(found).toMatchObject({
        id: user.id,
        name: 'مشتری',
        phoneNumber: null,
        role: ROLES.CUSTOMER,
        orderCount: 0,
        totalSpent: 0,
      });
      expect(found).not.toHaveProperty('email');
      expect(await UserDao.findForAdmin(crypto.randomUUID())).toBeNull();
    });
  });

  describe('countCustomers', () => {
    it('counts customers only, and this Jalali month from 00:00 Tehran', async () => {
      const since = jalaliMonthStart(new Date());
      const started = new Date();
      const totalBefore = await UserDao.countCustomers();
      const sinceBefore = await UserDao.countCustomers(since);

      // 15 minutes into the 1st in Tehran is 20:45 UTC on the day before.
      await makeUser({ createdAt: new Date(since.getTime() + 15 * MINUTE) });
      await makeUser({ createdAt: since });
      // 23:59 Tehran on the last day of the previous month.
      await makeUser({ createdAt: new Date(since.getTime() - MINUTE) });
      // Admins are made by the CLI and do not «join».
      await makeUser({
        role: ROLES.ADMIN,
        createdAt: new Date(since.getTime() + 15 * MINUTE),
      });

      const totalAfter = await UserDao.countCustomers();
      const sinceAfter = await UserDao.countCustomers(since);
      // Anyone who signed up on the shared dev database meanwhile is a
      // customer made now, so in both counts: counted out, which leaves the
      // deltas exactly what the four rows above add.
      const strangers = await testDb.$count(
        users,
        and(
          eq(users.role, ROLES.CUSTOMER),
          gte(users.createdAt, started),
          notInArray(users.id, fx.userIds),
        ),
      );

      expect(totalAfter - totalBefore - strangers).toBe(3);
      expect(sinceAfter - sinceBefore - strangers).toBe(2);
    });
  });
});
