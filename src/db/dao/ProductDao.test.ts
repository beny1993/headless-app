// No database needed — `@/db` is mocked, as in UserDao.test.ts. The behaviour
// of these methods is covered against a real Postgres in
// ./ProductDao.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));

const { ProductDao } = await import('./ProductDao');

describe('ProductDao — the soft-delete contract', () => {
  it('exposes no hard-delete method at all', () => {
    // The AC is about the shape of the surface, not only its behaviour: if no
    // caller *can* hard-delete a product, no order item can ever be orphaned
    // from the row whose title, sku and unit price it snapshotted. A future
    // `deleteById` here fails this test rather than quietly shipping.
    const removers = Object.getOwnPropertyNames(ProductDao).filter((name) =>
      /delete|destroy|remove|purge|drop/i.test(name),
    );

    expect(removers).toEqual(['softDelete']);
  });
});
