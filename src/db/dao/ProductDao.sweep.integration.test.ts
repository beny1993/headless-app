// Needs a live database — see src/db/test-db.ts. The sweep that switches off
// the products a killed test run left behind (`deactivateStaleTestProducts`).
import { afterEach, describe, expect, it } from 'vitest';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)(
  'ProductDao.deactivateStaleTestProducts',
  () => {
    const fx = new OrderFixtures();
    afterEach(() => fx.cleanup());

    const token = () => crypto.randomUUID().slice(0, 12);
    const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

    it('switches off stale test-/e2e- products and nothing else, idempotently', async () => {
      const category = await fx.category();
      const leakedFixture = await fx.product(category, {
        slug: `test-${token()}`,
        createdAt: dayAgo(),
      });
      const leakedE2e = await fx.product(category, {
        slug: `e2e-${token()}`,
        createdAt: dayAgo(),
      });
      // Contains `test-` but does not start with it — a real product slug.
      const normal = await fx.product(category, {
        slug: `qa-photo-test-${token()}`,
        createdAt: dayAgo(),
      });
      const alreadyOff = await fx.product(category, {
        slug: `test-${token()}`,
        createdAt: dayAgo(),
        isActive: false,
      });
      // A concurrent run's fixture, created moments ago: not a leak yet.
      const fresh = await fx.product(category, { slug: `test-${token()}` });

      expect(
        await ProductDao.deactivateStaleTestProducts(),
      ).toBeGreaterThanOrEqual(2);

      const rows = await ProductDao.getByIds(testDb, [
        leakedFixture.id,
        leakedE2e.id,
        normal.id,
        alreadyOff.id,
        fresh.id,
      ]);
      const active = Object.fromEntries(rows.map((r) => [r.id, r.isActive]));
      expect(active).toEqual({
        [leakedFixture.id]: false,
        [leakedE2e.id]: false,
        [normal.id]: true,
        [alreadyOff.id]: false,
        [fresh.id]: true,
      });

      // Nothing stale is left, so a second sweep switches nothing off.
      expect(await ProductDao.deactivateStaleTestProducts()).toBe(0);
    });
  },
);
