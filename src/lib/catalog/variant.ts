// A product family: one product filed as several smells, colours or sizes.
//
// The whole model is two nullable columns on `products` — `variant_of` (a
// one-level self-FK, like `categories.parent_id`) and `variant_label`. A member
// of a family is an ordinary product row, which is the point: its own slug, sku,
// price, stock and images, so nothing about money, the cart, the atomic stock
// decrement or `order_items` changes to support it.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the product
// form and the card are client-reachable, so this stays plain TypeScript, like
// `product-query.ts` and `product-input.ts`.
import { toPersianDigits } from '@/lib/format';

/**
 * The longest a label may be, after trimming. It renders on the product page's
 * heading, in the admin list and inside the `order_items` title snapshot, so it
 * is bounded like every other free-text field. «۱۰ کیلوگرم» and «آبی روشن» are
 * the shape this is sized for — a label longer than this is a description.
 */
export const VARIANT_LABEL_LIMIT = 40;

/** Persian, user-facing — these surface on the product form's fields. */
export const VARIANT_MESSAGES = {
  label: 'نوع محصول را بنویس (مثلاً «۱۰ کیلوگرم» یا «قرمز»).',
  labelLength: `نوع محصول حداکثر ${toPersianDigits(VARIANT_LABEL_LIMIT)} نویسه است.`,
  /** The one-level rule, refused by `ProductDao` — a CHECK cannot see two rows. */
  nested: 'این محصول خودش زیرمجموعه است؛ فقط یک سطح مجاز است.',
  /** A head with no label of its own would render an empty chip on the page. */
  headNeedsLabel: 'ابتدا برای محصول اصلی یک نوع تعیین کن.',
  /** `variant_of` pointing at a row that is gone, or at the product itself. */
  unknownHead: 'محصول اصلی انتخاب‌شده یافت نشد؛ صفحه را تازه کن.',
  /**
   * The head is soft-deleted. Hanging a member off it would produce the exact
   * row the `hasMembers` guard exists to prevent — active, buyable by its own
   * slug, listed on no shelf, because the storefront lists heads only.
   */
  inactiveHead: 'محصول اصلی انتخاب‌شده غیرفعال است؛ اول آن را فعال کن.',
  self: 'یک محصول نمی‌تواند زیرمجموعه خودش باشد.',
};
// `hasMembers` is deliberately NOT in there. Its copy needs the blocking count,
// so it is the function below — and a constant beside these would be a second
// Persian sentence for one refusal that nothing could ever reach. With the key
// absent, `VARIANT_MESSAGES[reason]` stops type-checking for that reason, which
// is what forces the thrower through `hasMembersMessage`.

/**
 * The refusal with the blocking count in it, mirroring the category manager's —
 * and, like it, naming how many rows are in the way, because «some» sends an
 * admin hunting. Counts **active** members only: an already-deactivated one is
 * listed nowhere, so it must not lock its head out of being deactivated too.
 *
 * «غیرفعال کن», not «حذف کن»: products are soft-deleted, so deleting is not a
 * thing the admin can be told to go and do.
 */
export const hasMembersMessage = (count: number): string =>
  `این محصول ${toPersianDigits(count)} زیرمجموعه فعال دارد؛ اول آن‌ها را جابه‌جا یا غیرفعال کن.`;

/** What `displayTitle` reads; a `Product` row satisfies it. */
type VariantFields = {
  /**
   * Required, though every caller passes a whole row anyway: this function
   * writes `order_items.title`, a permanent money document. While it was
   * optional, `displayTitle({ variantLabel: 'قرمز' })` type-checked and
   * returned a string opening with a bare dash — an invoice line naming no
   * product at all.
   */
  title: string;
  variantOf?: string | null;
  variantLabel?: string | null;
};

/**
 * What a shopper reads: «غذای خشک سگ — ۱۰ کیلوگرم», or just the title when the
 * product stands alone.
 *
 * The **single** derivation point. The product page heading, the admin list cell
 * and the `order_items` title snapshot all call this, so a line on a two-year-old
 * invoice and the chip on the page cannot word the same product differently.
 *
 * Both sides are trimmed: a stray space stored on either would otherwise show up
 * as a doubled separator, and a whitespace-only label reads as no label at all.
 */
export const displayTitle = (product: VariantFields): string => {
  const title = product.title.trim();
  const label = (product.variantLabel ?? '').trim();
  return label ? `${title} — ${label}` : title;
};
