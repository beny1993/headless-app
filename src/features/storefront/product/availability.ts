// What a product's stock count means on screen, in one place: the product page
// renders three different notices from it and the add button is enabled by it,
// and those two must never disagree — a page that says «ناموجود» above a live
// add button is the bug this module exists to prevent.
//
// This is display logic, not enforcement. The authoritative availability check
// is the atomic `UPDATE … WHERE stock >= qty` at order creation; a count read
// here is already stale by the time the shopper reads it.

export const AVAILABILITY = {
  IN_STOCK: 'in-stock',
  LOW_STOCK: 'low-stock',
  OUT_OF_STOCK: 'out-of-stock',
} as const;

type Availability = (typeof AVAILABILITY)[keyof typeof AVAILABILITY];

/** At or below this many units the page warns how few are left (design). */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * A stock count as one of three states.
 *
 * Anything that is not a positive count — zero, a negative that only a caller
 * bug could produce, `NaN` — reads as out of stock. Erring towards unavailable
 * is the safe direction: the worst case is a shopper who cannot buy something
 * we have, rather than an order for something we do not.
 */
export function availability(stock: number): Availability {
  if (!Number.isFinite(stock) || stock <= 0) return AVAILABILITY.OUT_OF_STOCK;
  if (stock <= LOW_STOCK_THRESHOLD) return AVAILABILITY.LOW_STOCK;
  return AVAILABILITY.IN_STOCK;
}

/** Whether the add-to-cart control is live. Low stock still buys. */
export function isPurchasable(stock: number): boolean {
  return availability(stock) !== AVAILABILITY.OUT_OF_STOCK;
}
