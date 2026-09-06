// The checkout discount preview — a read-only "what would this code take off?"
// for the checkout page, so the shopper sees the SERVER-computed amount before
// paying. It re-prices the cart server-side (never trusting a client total) and
// runs the SAME classification (`assertDiscountApplicable`) and money math
// (`computeDiscount`) the real order creation does — so the preview and the
// checkout can never disagree on whether a code applies or by how much.
//
// It deliberately does NOT claim a use (no `usage_count` increment, no lock): a
// preview is advisory. The authoritative guard is the atomic claim in
// `createOrder` at order time, which re-validates and re-checks the usage limit
// under concurrency. A code shown as applicable here can still 422 at submit if it
// was exhausted in the meantime — the FE surfaces that inline.
import { db } from '@/db';
import { DiscountCodeDao } from '@/db/dao/DiscountCodeDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { computeDiscount } from '@/lib/discount/discount-code';
import { assertDiscountApplicable } from '@/logic/checkout/discount';

/** What the preview returns — both figures server-computed, integer Toman. */
export type DiscountPreview = {
  /** The re-priced goods subtotal (active products at current prices). */
  subtotal: number;
  /** The discount the code would apply to that subtotal (0 when no code). */
  discount: number;
};

/**
 * Price the cart and, if a code was given, compute the discount it would apply.
 *
 * The subtotal is summed from `products.price` for the active products in the
 * cart — the same source `createOrder` re-prices from. A missing or inactive line
 * is simply left out of the subtotal here (the real checkout rejects it, naming
 * the line); the preview stays advisory. Throws a `CheckoutError` for an
 * unknown/inactive/expired/below-minimum/exhausted code, which the route maps to a
 * 422 `discountCode: message` the FE shows inline.
 */
export const previewDiscount = async (input: {
  items: { productId: string; qty: number }[];
  discountCode?: string;
}): Promise<DiscountPreview> => {
  const loaded = await ProductDao.getByIds(
    db,
    input.items.map((line) => line.productId),
  );
  const byId = new Map(loaded.map((product) => [product.id, product]));

  let subtotal = 0;
  for (const line of input.items) {
    const product = byId.get(line.productId);
    if (product && product.isActive) subtotal += product.price * line.qty;
  }

  if (input.discountCode === undefined) return { subtotal, discount: 0 };

  const found = await DiscountCodeDao.findByCode(db, input.discountCode);
  const applicable = assertDiscountApplicable(found, subtotal, new Date());
  return { subtotal, discount: computeDiscount(applicable, subtotal) };
};
