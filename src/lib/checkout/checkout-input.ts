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
//   · **Mass-assignment gate** — it names ONLY `items[].productId/qty`, `address`
//     and `paymentMethod`. `status`, `userId`, `subtotal`, `total`, `unitPrice`,
//     `discount` and `paidAt` are deliberately absent, so zod strips them: a body
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
import { paymentMethodSchema } from '@/lib/orders/order-status';
import { provinceIdParamSchema } from '@/lib/shipping/shipping-query';

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

const MAX_RECIPIENT_NAME = 200;
const MAX_RECIPIENT_PHONE = 20;
const MAX_CITY = 100;
const MAX_POSTAL_CODE = 20;
const MAX_ADDRESS_LINE = 500;
const MAX_DISCOUNT_CODE = 64;

/**
 * A required, length-bounded, null-byte-free text field. `.trim()` first so a
 * field of only whitespace fails `.min(1)` rather than storing blank; the refine
 * rejects U+0000 (constructed as an escape, never a literal byte) because it
 * would otherwise reach the `pg` driver and throw a 500 on insert.
 */
const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\u0000'), {
      message: 'must not contain a null byte',
    });

const cartLineSchema = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_LINE_QTY),
});

const addressSchema = z.object({
  recipientName: boundedText(MAX_RECIPIENT_NAME),
  recipientPhone: boundedText(MAX_RECIPIENT_PHONE),
  // The shared province contract, imported not restated — its `.max(INT4_MAX)`
  // cap must not drift, or the out-of-range → 500 hole the shipping story closed
  // reopens here. Required on purpose: `orders.province_id` is nullable at the DB
  // but `provinceName`/`shippingFee` are the load-bearing snapshots, so checkout
  // demands a real province.
  provinceId: provinceIdParamSchema,
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
  // Reserved for [[Story - Discount Codes]]. Present here so the contract is
  // stable, but `createOrder` 422s any non-empty code until that story wires the
  // atomic claim — see the design note.
  discountCode: boundedText(MAX_DISCOUNT_CODE).optional(),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type CheckoutAddressInput = z.infer<typeof addressSchema>;
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
