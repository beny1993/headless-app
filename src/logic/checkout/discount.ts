// The discount-code policy — the classification step that turns a loaded code row
// into either the row (applicable) or a specific Persian `CheckoutError`. Shared
// by `createOrder` (which runs it, then does the authoritative atomic claim) and
// the checkout preview (which runs it read-only, for display). Keeping it in one
// place is what makes the preview's "will this apply?" and the order's "does this
// apply?" agree — derive, never mirror.
//
// The money math itself (percent floor + clamp-to-subtotal) is the pure
// `computeDiscount` in the client-safe `@/lib/discount/discount-code`; this module
// is only the server-side policy + Persian copy.
import type { DiscountCode } from '@/db/schema/discounts';
import { formatToman } from '@/lib/format';
import { CheckoutError } from '@/logic/checkout/checkout-error';

// Persian, customer-facing. Distinct messages per failure so the shopper knows
// what to do; the atomic claim in `createOrder` is the authoritative guard, so a
// code that passes these checks but loses the usage race still 422s (as EXHAUSTED).
export const DISCOUNT_UNKNOWN = 'کد تخفیف واردشده معتبر نیست.';
export const DISCOUNT_INACTIVE = 'کد تخفیف واردشده غیرفعال است.';
export const DISCOUNT_EXPIRED =
  'مهلت استفاده از این کد تخفیف به پایان رسیده است.';
export const DISCOUNT_EXHAUSTED =
  'ظرفیت استفاده از این کد تخفیف تکمیل شده است.';
export const belowMinimumMessage = (minOrderAmount: number) =>
  `این کد تخفیف برای سفارش‌های از ${formatToman(minOrderAmount)} به بالا است.`;

/** The `field` every discount `CheckoutError` carries — maps to the code input. */
export const DISCOUNT_FIELD = 'discountCode';

/**
 * Classify a loaded code row against a server-computed `subtotal` at `now`.
 * Throws a specific Persian `CheckoutError` for an unknown/inactive/expired/
 * below-minimum/already-exhausted code, or returns the row when it is applicable.
 *
 * This is advisory for the failure *message* only — between this read and the
 * atomic `claim` a concurrent checkout could exhaust the code, which the claim
 * catches (0 rows → EXHAUSTED). The min-order check lives here because it needs
 * the subtotal, which the claim's SQL does not have; a below-minimum order is
 * rejected before any claim, so it never consumes a use.
 */
export const assertDiscountApplicable = (
  code: DiscountCode | null,
  subtotal: number,
  now: Date,
): DiscountCode => {
  if (!code) throw new CheckoutError(DISCOUNT_FIELD, DISCOUNT_UNKNOWN);
  if (!code.isActive)
    throw new CheckoutError(DISCOUNT_FIELD, DISCOUNT_INACTIVE);
  if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) {
    throw new CheckoutError(DISCOUNT_FIELD, DISCOUNT_EXPIRED);
  }
  if (subtotal < code.minOrderAmount) {
    throw new CheckoutError(
      DISCOUNT_FIELD,
      belowMinimumMessage(code.minOrderAmount),
    );
  }
  if (code.usageLimit !== null && code.usageCount >= code.usageLimit) {
    throw new CheckoutError(DISCOUNT_FIELD, DISCOUNT_EXHAUSTED);
  }
  return code;
};
