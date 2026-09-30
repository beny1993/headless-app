// The checkout lock's strength: FOR NO KEY UPDATE, not FOR UPDATE. The
// foreign-key check behind an insert that references the user takes FOR KEY
// SHARE on that user's row, which only FOR UPDATE blocks, so while a checkout
// holds the lock the account can still save a pet or an address.
//
// Needs a live database — see src/db/test-db.ts: the conflict is Postgres's
// lock table, which a mocked `db` does not have.
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { pets } from '@/db/schema/account';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { PET_GENDERS } from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';

const { UserDao } = await importWithDb(() => import('@/db/dao/UserDao'));

describe.skipIf(!databaseReachable)('UserDao.lockForCheckout', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  it('lets the account save a pet while a checkout holds its lock', async () => {
    const user = await fx.user();
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
          .insert(pets)
          .values({
            userId: user.id,
            name: 'پیشی',
            type: PET_TYPES.CAT,
            gender: PET_GENDERS.FEMALE,
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
