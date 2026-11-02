// The shop shelves `sitemap.xml` names. The categories come from one DAO and
// whether each shelf lists anything from another, hence src/logic/.
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { shopPath } from '@/lib/constant/paths';

/**
 * Every category shelf that lists at least one product, as the path
 * the shop links to. A shelf that lists nothing answers with the empty state:
 * noindexed, and a soft 404 to Google if the sitemap names it.
 */
export async function listStockedShelves(): Promise<string[]> {
  const shelves = [
    ...(await CategoryDao.list()).map(({ slug }) => ({
      path: shopPath({ category: slug }),
      filters: { categorySlug: slug },
    })),
  ];
  const stocked = await Promise.all(
    shelves.map((shelf) => ProductDao.hasShelfProducts(shelf.filters)),
  );
  return shelves.filter((_, index) => stocked[index]).map(({ path }) => path);
}
