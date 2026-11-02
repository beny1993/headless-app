// The admin's «پیشنهادهای ما» picks, read as the cards the home page shows:
// ids stored in content (`home.recommends.productIds`) resolved against the
// catalog, beside `loadLinkTargets`, hence src/logic/.
import { ProductDao } from '@/db/dao/ProductDao';
import type { ProductCard } from '@/db/schema/catalog';

/**
 * The picked card for each box, in box order — `undefined` for a box on
 * «خودکار», or whose pick is no longer a card the shop lists. A pick already in
 * `listed` (the listing page the home page reads anyway, same cards) is taken
 * from there; only the rest are read, in one query — none at all when every
 * pick is on that page.
 */
export async function loadFeaturedPicks(
  productIds: readonly (string | null)[] | undefined,
  listed: readonly ProductCard[],
): Promise<(ProductCard | undefined)[]> {
  const picks = productIds ?? [];
  const cards = new Map(listed.map((card) => [card.id, card]));
  const missing = picks.filter(
    (id): id is string => id !== null && !cards.has(id),
  );
  for (const card of await ProductDao.cardsByIds(missing)) {
    cards.set(card.id, card);
  }
  return picks.map((id) => (id === null ? undefined : cards.get(id)));
}
