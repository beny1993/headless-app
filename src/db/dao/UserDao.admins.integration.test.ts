// The new-order alert's recipient list. A real database because the whole
// method IS a `where` clause — a mocked `db` would only re-state it.
//
// The filter is authz-adjacent: a customer is never an admin recipient, however
// many phone numbers they have. Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { ROLES, users, type Role } from '@/db/schema/auth';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { UserDao } = await importWithDb(() => import('@/db/dao/UserDao'));

const token = () => crypto.randomUUID().slice(0, 12);

/** A phone in the canonical form the auth layer stores. */
const phone = () =>
  `+98991${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

describe.skipIf(!databaseReachable)('UserDao.listAdminsWithPhone', () => {
  const ids: string[] = [];

  afterEach(async () => {
    if (ids.length === 0) return;
    await testDb.delete(users).where(inArray(users.id, ids));
    ids.length = 0;
  });

  const seed = async (role: Role, phoneNumber: string | null) => {
    const t = token();
    const [row] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: 'کاربر آزمایشی',
        email: `admins-${t}@example.com`,
        role,
        phoneNumber,
      })
      .returning();
    ids.push(row.id);
    return row;
  };

  // The dev database carries real rows (pnpm create-admin, the E2E suite), so
  // every assertion is about this suite's own fixtures, never about a count.
  const listedIds = async () =>
    (await UserDao.listAdminsWithPhone()).map((admin) => admin.id);

  it('lists an admin who has a phone number', async () => {
    const admin = await seed(ROLES.ADMIN, phone());

    expect(await listedIds()).toContain(admin.id);
  });

  it('skips an admin with no phone number — an email-era account', async () => {
    const admin = await seed(ROLES.ADMIN, null);

    expect(await listedIds()).not.toContain(admin.id);
  });

  it('skips a customer, phone or no phone', async () => {
    // The filter that matters: customers get sessions and phone numbers as a
    // matter of course, and an order alert carries no customer data BECAUSE it
    // only ever goes to staff.
    const customer = await seed(ROLES.CUSTOMER, phone());

    expect(await listedIds()).not.toContain(customer.id);
  });

  it('lists every admin, not just the first', async () => {
    const one = await seed(ROLES.ADMIN, phone());
    const two = await seed(ROLES.ADMIN, phone());

    const listed = await listedIds();
    expect(listed).toContain(one.id);
    expect(listed).toContain(two.id);
  });

  it('carries the phone number itself, non-null', async () => {
    const admin = await seed(ROLES.ADMIN, phone());

    const found = (await UserDao.listAdminsWithPhone()).find(
      (row) => row.id === admin.id,
    );
    expect(found?.phoneNumber).toBe(admin.phoneNumber);
  });
});
