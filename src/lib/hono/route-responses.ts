/**
 * Shared pieces of a `createRoute` definition — the OpenAPI half.
 *
 * These live here rather than in `envelope.ts` because only the route files
 * use them, while `envelope.ts` reaches the browser (`api-client.ts` imports
 * `unwrap` from it): route-definition machinery there ships to every admin page.
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
 * A client-safe projection (one definition, imported by the server page that
 * renders the first paint too) rebuilt into a local `z.object` and registered
 * as the OpenAPI component `name`. Rebuilt because `.openapi()` is grafted on by
 * `@hono/zod-openapi` and zod 4 hands it to newly built schemas only, so calling
 * it on an imported one depends on module evaluation order (the trap documented
 * above `ProductListQuerySchema` in ./routes/catalog.ts).
 *
 * The ceiling that buys: `.shape` copies the FIELDS. An object-level modifier
 * on the source schema — `.strict()`, `.catchall()`, `.refine()`, a `.meta()`
 * on the object itself — is silently left behind, and the document would drift
 * with no failing test. None of the projections has one today. Add one there
 * and it has to be repeated here, or the two stop being one definition.
 */
export const openapiObject = <T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  name: string,
) => z.object(schema.shape).openapi(name);

/**
 * The `{ id }` path parameter of every uuid-keyed route. The int-keyed province
 * routes keep `provinceIdParamSchema`, which is a different type entirely.
 */
export const IdParamSchema = z.object({
  id: z.uuid().meta({
    param: { name: 'id', in: 'path' },
    example: '123e4567-e89b-12d3-a456-426614174000',
  }),
});
