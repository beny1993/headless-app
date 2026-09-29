import type { ProductCard } from '@/db/schema/catalog';

type Priced = Pick<
  ProductCard,
  | 'price'
  | 'oldPrice'
  | 'stock'
  | 'familyMinPrice'
  | 'familyPricesVary'
  | 'familyInStock'
>;

/**
 * What a storefront card prints: the family's buyable price, and a «was»
 * price only when it belongs to the number printed.
 *
 * `familyMinPrice`, never the row's own `price`: a sold-out head is not a
 * price anyone can buy at, and for a standalone product the two are equal.
 * The head's `oldPrice` is the head's, so it is the printed price's «was» only
 * when the head's own price is the one printed — one price across the family,
 * and the head among the members priced (in stock, or nothing is).
 */
export function cardPrice(card: Priced): {
  price: number;
  oldPrice: number | null;
} {
  const headIsPrinted =
    !card.familyPricesVary && (card.stock > 0 || !card.familyInStock);
  return {
    price: card.familyMinPrice,
    oldPrice: headIsPrinted ? card.oldPrice : null,
  };
}
