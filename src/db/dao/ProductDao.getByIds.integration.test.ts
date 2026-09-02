// Needs a live database — see src/db/test-db.ts. `getByIds` is the read checkout
// composes to load each ordered product FRESH before reserving its stock: it must
// return soft-deleted rows too (checkout rejects an inactive product by its
// `isActive`, which an active-only read could never show it). A new file rather
// than an edit to ProductDao.integration.test.ts — the checkout story adds this
// method and owns its coverage.
import { describe, expect, it, afterEach } from 'vitest';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao.getByIds', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  it('returns the rows for the given ids', async () => {
    const category = await fx.category();
    const a = await fx.product(category);
    const b = await fx.product(category);

    const rows = await ProductDao.getByIds(testDb, [a.id, b.id]);

    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('includes a soft-deleted product (checkout must see isActive to reject it)', async () => {
    const category = await fx.category();
    const product = await fx.product(category, { isActive: false });

    const [row] = await ProductDao.getByIds(testDb, [product.id]);

    expect(row.id).toBe(product.id);
    expect(row.isActive).toBe(false);
  });

  it('silently omits ids that do not exist', async () => {
    const category = await fx.category();
    const product = await fx.product(category);
    const missing = crypto.randomUUID();

    const rows = await ProductDao.getByIds(testDb, [product.id, missing]);

    expect(rows.map((r) => r.id)).toEqual([product.id]);
  });

  it('returns an empty array for an empty id list without querying', async () => {
    expect(await ProductDao.getByIds(testDb, [])).toEqual([]);
  });
});
