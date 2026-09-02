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

/** Postgres `integer` (int4) upper bound — the id columns' real ceiling. */
const INT4_MAX = 2_147_483_647;

/**
 * The `?province=` query value and the checkout body's `address.provinceId`: a
 * province's numeric id.
 *
 * `z.coerce` because a query string arrives as text; `.int().positive()` because
 * identity ids start at 1. `.max(INT4_MAX)` is load-bearing, not cosmetic: the
 * `provinces.id` / `shipping_rates.province_id` columns are int4, but `.int()`
 * alone admits anything up to `Number.MAX_SAFE_INTEGER`. Without the cap an id
 * in the gap — e.g. `?province=2147483648` — passes validation and reaches
 * Postgres as a bound parameter it infers as int4 from the `id = $1` context,
 * which errors out of range (22003) and surfaces as a 500, not the 400 an
 * unknown province must get. `.int()` stops `1e30`; the cap stops everything
 * between int4 and 2^53. Both the public GET and the admin PUT inherit it.
 *
 * This is also the whole of the null-byte story for this endpoint: a numeric id
 * can never carry a meaningful U+0000, and coercion turns any such input into
 * NaN/0, both rejected here — so, unlike the catalog's text params, there is no
 * null byte or Persian-normalization step to run, and nothing reaches the driver
 * as text that could throw a 500.
 */
export const provinceIdParamSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(INT4_MAX);

/**
 * The admin rate-update fee: integer Toman, zero allowed.
 *
 * A JSON body carries a real number, so no coercion — a fee sent as a string is
 * a bug worth a 400, not something to silently coerce. `.nonnegative()` matches
 * the `shipping_rates.fee >= 0` CHECK: free shipping is a valid rate, only a
 * negative one is illegal. `.int()` keeps it whole and safe.
 */
export const shippingFeeSchema = z.number().int().nonnegative();
