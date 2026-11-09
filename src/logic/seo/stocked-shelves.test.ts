// Which shelves the sitemap names. The DAOs are mocked at their edge; what
// "lists something" means (active heads, sub-categories, extra filings) is
// proven against a real database by `hasShelfProducts`'s own
// suite.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shopPath } from '@/lib/constant/paths';

const dao = vi.hoisted(() => ({
  hasShelfProducts: vi.fn(),
  listCategories: vi.fn(),
}));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: { hasShelfProducts: dao.hasShelfProducts },
}));
vi.mock('@/db/dao/CategoryDao', () => ({
  CategoryDao: { list: dao.listCategories },
}));

import { listStockedShelves } from './stocked-shelves';

/** Every shelf lists something except these, named by category slug. */
const listNothing = (...shelves: string[]) =>
  dao.hasShelfProducts.mockImplementation(
    async (shelf: { categorySlug?: string }) =>
      !shelves.includes(shelf.categorySlug ?? ''),
  );

describe('listStockedShelves', () => {
  beforeEach(() => {
    dao.hasShelfProducts.mockReset();
    dao.listCategories.mockResolvedValue([
      { slug: 'dry-food' },
      { slug: 'treats' },
    ]);
  });

  it('names every category shelf that lists something', async () => {
    listNothing();

    expect(await listStockedShelves()).toEqual([
      shopPath({ category: 'dry-food' }),
      shopPath({ category: 'treats' }),
    ]);
  });

  it('leaves out a shelf that lists nothing', async () => {
    listNothing('treats');

    expect(await listStockedShelves()).toEqual([
      shopPath({ category: 'dry-food' }),
    ]);
  });
});
