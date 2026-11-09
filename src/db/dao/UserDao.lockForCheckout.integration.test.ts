// The checkout lock's strength: FOR NO KEY UPDATE, not FOR UPDATE. The
// foreign-key check behind an insert that references the user takes FOR KEY
// SHARE on that user's row, which only FOR UPDATE blocks, so while a checkout
// holds the lock the account can still save an address.
//
// Needs a live database — see src/db/test-db.ts: the conflict is Postgres's
// row locking, which a mocked `db` does not have.
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountFixtures } from '@/db/account-test-fixtures';
import { addresses } from '@/db/schema/account';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { UserDao } = await importWithDb(() => import('@/db/dao/UserDao'));

describe.skipIf(!databaseReachable)('UserDao.lockForCheckout', () => {
  const fx = new AccountFixtures();
  afterEach(() => fx.cleanup());

  it('lets the account save an address while a checkout holds its lock', async () => {
    const user = await fx.user();
    const province = await fx.province();
    let lockHeld!: () => void;
    const locked = new Promise<void>((resolve) => (lockHeld = resolve));
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => (releaseLock = resolve));

    const checkout = testDb.transaction(async (tx) => {
      await UserDao.lockForCheckout(tx, user.id);
      lockHeld();
      await released;
    });

    try {
      // A lock that throws rejects `checkout`, and the race with it, rather
      // than leaving this test waiting on `locked` until it times out.
      await Promise.race([locked, checkout]);

      // Another connection, and a bounded wait: were the lock FOR UPDATE, this
      // insert's foreign-key check would queue behind the checkout and give up.
      const saved = testDb.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '1s'`);
        return tx
          .insert(addresses)
          .values({
            userId: user.id,
            recipientName: 'مشتری آزمایشی',
            recipientPhone: '+989120000000',
            provinceId: province.id,
            city: 'تهران',
            postalCode: '1234567890',
            addressLine: 'خیابان آزمایش، پلاک ۱',
          })
          .returning();
      });

      await expect(saved).resolves.toHaveLength(1);
    } finally {
      releaseLock();
      await checkout;
    }
  });
});
