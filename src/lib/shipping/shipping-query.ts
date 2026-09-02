// The shipping API's input contract — one client-safe definition both sides of
// the wire share, exactly like `@/lib/catalog/product-query`. `GET
// /api/shipping/rates?province=` and `PUT /api/shipping/rates/{provinceId}`
// validate with these; the checkout form (a `'use client'` component) reuses the
// same `provinceIdParamSchema` for its fee-preview call, so the two can never
// drift on what a province id may be.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the reason
// the file exists on the `@/lib` side of the app. Plain zod is safe in a browser
// bundle; the DAO and the route are not. The route decorates these with OpenAPI
// descriptions via `.meta()` (never `.openapi()`; see the note in
// `@/lib/hono/routes/catalog.ts`).
import { z } from 'zod';

/**
 * The `?province=` query value and the checkout body's `address.provinceId`: a
 * province's numeric id.
 *
 * `z.coerce` because a query string arrives as text; `.int()` (zod 4 caps it at
 * `Number.MAX_SAFE_INTEGER`) keeps `?province=1e30` from reaching Postgres as an
 * id no `integer` can hold; `.positive()` because identity ids start at 1. This
 * is also the whole of the null-byte story for this endpoint: a numeric id can
 * never carry a meaningful U+0000, and coercion turns any such input into NaN/0,
 * both rejected here — so, unlike the catalog's text params, there is no null
 * byte or Persian-normalization step to run, and nothing reaches the driver as
 * text that could throw a 500.
 */
export const provinceIdParamSchema = z.coerce.number().int().positive();

/**
 * The admin rate-update fee: integer Toman, zero allowed.
 *
 * A JSON body carries a real number, so no coercion — a fee sent as a string is
 * a bug worth a 400, not something to silently coerce. `.nonnegative()` matches
 * the `shipping_rates.fee >= 0` CHECK: free shipping is a valid rate, only a
 * negative one is illegal. `.int()` keeps it whole and safe.
 */
export const shippingFeeSchema = z.number().int().nonnegative();
