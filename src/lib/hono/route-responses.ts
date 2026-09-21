/**
 * Shared pieces of a `createRoute` definition — the OpenAPI half.
 *
 * These live here rather than in `envelope.ts` because only the route files
 * ever use them, while `envelope.ts` reaches the browser: `api-client.ts`
 * value-imports `unwrap` from it, and both admin forms are `'use client'`.
 * Adding route-definition machinery there would have shipped more of it to
 * every admin page.
 *
 * This does NOT fix that bundle — `envelope.ts` still side-effect-imports
 * `@hono/zod-openapi` for `apiErrorSchema`/`apiSuccessSchema`, so the package
 * still travels. Splitting the client half out of `envelope.ts` is issue #66's
 * item and stays there; this only stops the pile growing.
 */
import { z } from 'zod';
import { apiErrorSchema } from './envelope';

/**
 * One non-2xx entry for a route's `responses` map. Every error response in every
 * route file is this exact shape — the shared `apiErrorSchema` and a description
 * — so it lives here once rather than being redeclared per file.
 */
export const errorResponse = (description: string) =>
  ({
    content: { 'application/json': { schema: apiErrorSchema } },
    description,
  }) as const;

/**
 * The `{ id }` path parameter of the uuid-keyed admin routes (products,
 * categories, discount codes).
 *
 * Four other uuid params carry no `example` — `/orders/{id}`, `/me/pets/{id}`,
 * `/me/addresses/{id}`, `/admin/orders/{id}` — and the `example` is part of the
 * generated document, so folding them in here would change it. They keep their
 * own local schemas for that reason alone; nothing on record says the missing
 * `example` was a choice rather than drift. The int-keyed province routes keep
 * `provinceIdParamSchema`, which is a different type entirely.
 */
export const IdParamSchema = z.object({
  id: z.uuid().meta({
    param: { name: 'id', in: 'path' },
    example: '123e4567-e89b-12d3-a456-426614174000',
  }),
});
