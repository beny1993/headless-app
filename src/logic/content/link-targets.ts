// Where saved content links point, read from the catalog: the one module that
// turns the ids a content block stores (`collectLinkRefs`) into the slugs a
// storefront href needs (`resolveLink`), and the save-side check that each id
// still names something. It spans CategoryDao and ProductDao, hence src/logic/.
import { db } from '@/db';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  collectLinkRefs,
  LINK_MESSAGES,
  type LinkTargets,
} from '@/lib/content/link';

/**
 * The slug maps `resolveLink` needs for every link in `values`: all categories
 * when any link names one (the table is a handful of rows), and the referenced
 * products that are still active — a hidden or deleted product is left out, so
 * its link resolves to the shop. No link ids, no queries. A caller already
 * holding the category rows (the home page) passes them to skip that read.
 * The «انتخاب‌های اسموکی» picks (`card` refs) are not links and are never
 * loaded here; the home page reads them as cards.
 */
export async function loadLinkTargets(
  values: readonly unknown[],
  categories?: readonly { id: string; slug: string }[],
): Promise<LinkTargets> {
  const refs = values.flatMap((value) => collectLinkRefs(value));
  const productIds = [
    ...new Set(
      refs.filter((ref) => ref.kind === 'product').map((ref) => ref.id),
    ),
  ];
  const [categoryRows, products] = await Promise.all([
    refs.some((ref) => ref.kind === 'category')
      ? (categories ?? CategoryDao.list())
      : [],
    ProductDao.getByIds(db, productIds),
  ]);
  return {
    categories: Object.fromEntries(
      categoryRows.map((category) => [category.id, category.slug]),
    ),
    products: Object.fromEntries(
      products
        .filter((product) => product.isActive)
        .map((product) => [product.id, product.slug]),
    ),
  };
}

const MISSING = {
  category: LINK_MESSAGES.missingCategory,
  product: LINK_MESSAGES.missingProduct,
  card: LINK_MESSAGES.missingCard,
} as const;

/**
 * The save-side check: one `path: message` error (the zod 400's own shape, so
 * the editor maps it onto the field) for each id in `value` that names no
 * category, no active product for a link, or no card the shop lists for a
 * «انتخاب‌های اسموکی» box — read through the same `cardsByIds` the home page
 * shows its picks with, so a family member (a valid link target, never a card)
 * is refused here instead of being stored and silently never shown. The ids are
 * already uuids — the block's schema runs first.
 */
export async function findBrokenLinks(value: unknown): Promise<string[]> {
  const refs = collectLinkRefs(value);
  const [targets, cards] = await Promise.all([
    loadLinkTargets([value]),
    ProductDao.cardsByIds(
      refs.filter((ref) => ref.kind === 'card').map((ref) => ref.id),
    ),
  ]);
  const listed = new Set(cards.map((card) => card.id));
  const resolves = ({ kind, id }: (typeof refs)[number]) =>
    kind === 'card'
      ? listed.has(id)
      : Object.hasOwn(
          kind === 'category' ? targets.categories : targets.products,
          id,
        );
  return refs
    .filter((ref) => !resolves(ref))
    .map((ref) => `${ref.path}: ${MISSING[ref.kind]}`);
}
