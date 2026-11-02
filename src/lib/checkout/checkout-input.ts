// The checkout request contract — one client-safe definition both sides share,
// exactly like `@/lib/catalog/product-query` and `@/lib/shipping/shipping-query`.
// `POST /api/checkout` validates the body with it; the checkout form (a
// `'use client'` component in a later story) reuses it so the two can never drift
// on what a cart line, an address or a payment method may be.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the reason
// the file lives on the `@/lib` side. Plain zod is safe in a browser bundle; the
// DAO and the route are not. The route uses this schema as the request body
// directly (inlined in the OpenAPI doc); it builds its own response schemas with
// `.openapi()` there — plain zod here stays browser-safe.
//
// This schema is a trust boundary doing three security jobs at once:
//   · **Mass-assignment gate** — it names ONLY `items[].productId/qty`, `address`,
//     the payment and delivery methods, a discount code and the shopper's note.
//     `status`, `userId`, `subtotal`, `total`, `unitPrice`, `discount` and
//     `paidAt` are deliberately absent, so zod strips them: a body
//     that smuggles `status:'delivered'` reaches `createOrder` without it, and the
//     server sets every one of those fields itself (see the story's carried-in
//     constraints).
//   · **500-hole gate** — `productId` is `z.uuid()` (a non-uuid in `WHERE id = $1`
//     against a uuid column is a 22P02 the driver throws as a 500), `provinceId`
//     inherits the int4 cap from `provinceIdParamSchema`, and every text field
//     rejects a U+0000 (Postgres refuses a null byte inside a text parameter and
//     the `pg` driver throws it as a 500).
//   · **Overflow gate** — `qty` and the line count are capped, so no summed total
//     can approach 2^53 (bigint money is read in `mode:'number'`). `qty × price`
//     cannot be bounded here — price is unknown at this layer — so `createOrder`
//     carries a `Number.isSafeInteger` backstop over the computed totals.
import { z } from 'zod';
import {
  DELIVERY_METHODS,
  deliveryMethodSchema,
} from '@/lib/orders/delivery-method';
import { paymentMethodSchema } from '@/lib/orders/order-status';
import { provinceIdParamSchema } from '@/lib/shipping/shipping-query';
import {
  boundedText,
  optionalBoundedText,
  VISIBLE_CHAR,
} from '@/lib/validation/text';

/**
 * The most distinct products one cart may hold. A cart with more lines than this
 * is a bug or an attack, not a shopper — answering it with a truncated order
 * would hide which. The count, together with `MAX_LINE_QTY`, bounds the summed
 * subtotal well under `Number.MAX_SAFE_INTEGER`.
 */
export const MAX_CART_LINES = 50;

/**
 * The most units of one product a single line may reserve. Real stock is int4
 * and the oversell guard caps a line at the on-hand quantity anyway; this is the
 * far looser sanity ceiling that keeps `qty` itself from being an overflow lever.
 */
export const MAX_LINE_QTY = 1000;

// Field caps. `boundedText` itself (the trim / min(1) / max / null-byte gate) is
// shared with the account address contract in `@/lib/validation/text` so the
// U+0000 500-hole gate is defined once and never hand-mirrored across boundaries.
const MAX_RECIPIENT_NAME = 200;
const MAX_RECIPIENT_PHONE = 20;
const MAX_CITY = 100;
const MAX_POSTAL_CODE = 20;
const MAX_ADDRESS_LINE = 500;
/** Cap on a checkout discount code; shared with the admin create contract. */
export const MAX_DISCOUNT_CODE = 64;

/** Cap on the shopper's free-text note to the shop. */
export const MAX_CUSTOMER_NOTE = 500;

/**
 * The shopper's optional note on the order («یه روز دیرتر بفرستید», «رنگ
 * آبی»). Trimmed, capped and character-checked like every free-text field —
 * newlines and tabs pass, the bidi family and control characters do not —
 * and blank becomes absent, so a cleared textarea stores no note. A line
 * with nothing visible on it (spaces, NBSP, a lone ZWNJ) is blank, each line
 * loses its trailing whitespace, and runs of blank lines fold to one: a note
 * is read on a narrow admin screen, and five hundred newlines would push the
 * order off it. A note with nothing visible at all is no note — else the
 * admin list would flag an order whose note reads empty.
 *
 * The form sends what this returns, not what was typed, so the body it
 * hashes for its Idempotency-Key is the note the server stores.
 */
export const customerNoteSchema = optionalBoundedText(
  MAX_CUSTOMER_NOTE,
).transform((value) => {
  if (value === undefined || !VISIBLE_CHAR.test(value)) return undefined;
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (VISIBLE_CHAR.test(line) ? line.trimEnd() : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
});

const cartLineSchema = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_LINE_QTY),
});

/**
 * The delivery-address contract. Exported so the account address book derives
 * its own schema from it (`@/lib/account/address`) rather than re-declaring these
 * fields — a saved address IS a checkout address plus an id and a label, so the
 * checkout prefill is a field-for-field assignment with no mapping.
 */
export const addressSchema = z.object({
  recipientName: boundedText(MAX_RECIPIENT_NAME),
  recipientPhone: boundedText(MAX_RECIPIENT_PHONE),
  // The shared province contract, imported not restated — its `.max(INT4_MAX)`
  // cap must not drift, or the out-of-range → 500 hole the shipping story closed
  // reopens here. Required on purpose: `orders.province_id` is nullable at the DB
  // but `provinceName`/`shippingFee` are the load-bearing snapshots, so checkout
  // demands a real province.
  //
  // Intersected with `z.number()` because `provinceIdParamSchema` is `z.coerce`
  // (built for the `?province=` query string, where every value is text). In this
  // JSON body a real number is what a correct client sends, so a string `"5"` or a
  // boolean is a bug worth a 400, not something to coerce — the same stance
  // `shipping-query.ts` takes for its JSON-body fee. `.and()` makes the raw value
  // clear `z.number()` too (a string never does), while the imported schema stays
  // the sole authority on the int4 cap — no drift, no re-mirror. (`.pipe()` cannot
  // express this: a coerced schema's input type is `unknown`, not `number`.)
  provinceId: z.number().and(provinceIdParamSchema),
  city: boundedText(MAX_CITY),
  postalCode: boundedText(MAX_POSTAL_CODE),
  addressLine: boundedText(MAX_ADDRESS_LINE),
});

export const checkoutInputSchema = z.object({
  items: z
    .array(cartLineSchema)
    .min(1)
    .max(MAX_CART_LINES)
    // Duplicate productId lines are rejected rather than merged — the simplest
    // unambiguous answer (a merge would silently rewrite the cart). The issue is
    // attached to the *second* occurrence so the 400 names the line to remove.
    .superRefine((items, ctx) => {
      const seen = new Map<string, number>();
      items.forEach((line, index) => {
        const first = seen.get(line.productId);
        if (first !== undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate productId (already on line ${first})`,
            path: [index],
          });
        } else {
          seen.set(line.productId, index);
        }
      });
    }),
  address: addressSchema,
  paymentMethod: paymentMethodSchema,
  // Post or courier ([[Story - Courier Delivery at Checkout]]). Defaults to
  // post: a client built before courier existed — a tab left open across a
  // deploy — sends none, and gets exactly the order it would have had. Where a
  // courier may go is `createOrder`'s call, against the province it looked up.
  deliveryMethod: deliveryMethodSchema.default(DELIVERY_METHODS.POST),
  // An optional discount code ([[Story - Discount Codes]]). Validated and applied
  // entirely server-side: `createOrder` normalizes it, computes the discount off
  // the re-priced subtotal, and claims one use atomically. Any text is accepted
  // here (a code that does not match simply 422s at checkout); the amount is never
  // client-supplied.
  discountCode: boundedText(MAX_DISCOUNT_CODE).optional(),
  // What the shopper wants the shop to know: a later delivery, a colour. Never
  // read by any rule — stored on the order and shown, nothing more.
  customerNote: customerNoteSchema,
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type CheckoutAddressInput = z.infer<typeof addressSchema>;
/**
 * The checkout body — as a client writes it, so `deliveryMethod` may be
 * absent (an older client, a fixture); `createOrder` reads absent as post,
 * exactly what the schema's default does to a parsed body.
 */
export type CheckoutInput = z.input<typeof checkoutInputSchema>;
