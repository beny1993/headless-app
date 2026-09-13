// Shared fixtures for the account (pets / addresses / order-history) integration
// suites. Import-safe with no database: it reaches only `testDb` (the null
// stand-in) and the schema modules (which never import `@/db`), so a DB-less run
// still collects and skips cleanly. DAOs are pulled in by each suite through
// `importWithDb`, never here.
//
// Teardown order respects the FKs: pets and addresses `cascade` from the user, so
// deleting the users clears both; provinces are `restrict`-referenced by
// addresses, so they come out only after the users that owned those addresses.
import { inArray } from 'drizzle-orm';
import { users, type User } from '@/db/schema/auth';
import { provinces, shippingRates, type Province } from '@/db/schema/shipping';
import { testDb } from '@/db/test-db';

const token = () => crypto.randomUUID().slice(0, 12);

/** A registry of everything a suite created, with an FK-safe teardown. */
export class AccountFixtures {
  readonly userIds: string[] = [];
  readonly provinceIds: number[] = [];

  async user(): Promise<User> {
    const t = token();
    const [row] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: 'مشتری آزمایشی',
        email: `test-${t}@example.com`,
      })
      .returning();
    this.userIds.push(row.id);
    return row;
  }

  async province(name = `استان ${token()}`): Promise<Province> {
    const [row] = await testDb.insert(provinces).values({ name }).returning();
    this.provinceIds.push(row.id);
    // With a rate, as every real writer creates one: an address may only be
    // saved against an active, rated province (`getByProvinceId`).
    await testDb
      .insert(shippingRates)
      .values({ provinceId: row.id, fee: 40_000 });
    return row;
  }

  async cleanup(): Promise<void> {
    if (this.userIds.length > 0) {
      // Cascades this user's pets and addresses.
      await testDb.delete(users).where(inArray(users.id, this.userIds));
      this.userIds.length = 0;
    }
    if (this.provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, this.provinceIds));
      await testDb
        .delete(provinces)
        .where(inArray(provinces.id, this.provinceIds));
      this.provinceIds.length = 0;
    }
  }
}
