// `z` comes from `zod`, not from `@hono/zod-openapi`, on purpose. That package
// ships no `types` condition in its `exports` map, so the `z` it re-exports
// resolves to `any` — schemas built from it infer as `any`, and every response
// type below would be a lie the compiler could not catch. Its `z` *is* zod's
// own `z` object (it patches it in place), so importing the package for its
// side effect and `z` from zod gives the same runtime value, fully typed.
import '@hono/zod-openapi';
import { z, type ZodError } from 'zod';

/** Standard success envelope. `status` is the discriminant clients branch on. */
export type ApiSuccess<T> = { status: 'success'; data: T };

/** Standard error envelope. `errors` is optional, human-readable detail. */
export type ApiError = { status: 'error'; message: string; errors?: string[] };

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Build a success envelope body. */
export const apiSuccess = <T>(data: T): ApiSuccess<T> => ({
  status: 'success',
  data,
});

/** Build an error envelope body. Omits `errors` when empty/absent. */
export const apiError = (message: string, errors?: string[]): ApiError =>
  errors && errors.length > 0
    ? { status: 'error', message, errors }
    : { status: 'error', message };

/**
 * Narrow a parsed response envelope to its `data`, throwing `Error(message)` on
 * the error branch. Use in consumers that should surface a failed request (e.g.
 * an SWR fetcher that wants a real error state). Centralizes the `.data` hop so
 * call sites can't silently read a field off an error envelope.
 */
export const unwrap = <T>(body: ApiResponse<T>): T => {
  // Anything that is neither branch is a route returning a bare body — the
  // envelope type is an unchecked assertion at every call site, so this is
  // reachable. Fail loudly here rather than handing back `undefined`.
  if (body?.status !== 'success' && body?.status !== 'error') {
    throw new Error('Malformed API response: missing success envelope');
  }
  if (body.status === 'error') {
    throw new Error(body.message);
  }
  return body.data;
};

/**
 * Narrow a parsed response envelope to its `data`, falling back to `fallback`
 * on the error branch. Use for best-effort reads where a failed request should
 * degrade to a default rather than throw.
 */
export const unwrapOr = <T>(body: ApiResponse<T>, fallback: T): T =>
  body.status === 'success' ? body.data : fallback;

/** Flatten a ZodError into "path: message" strings (bare message when no path). */
export const formatZodIssues = (error: ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

/** OpenAPI schema for the error envelope. Reuse in every route's error responses. */
export const apiErrorSchema = z
  .object({
    status: z.literal('error'),
    message: z.string(),
    errors: z.array(z.string()).optional(),
  })
  .openapi('ApiErrorResponse');

/** Wrap a data schema in the success envelope for OpenAPI response definitions. */
export const apiSuccessSchema = <T extends z.ZodType>(
  data: T,
  refName?: string,
) => {
  const schema = z.object({ status: z.literal('success'), data });
  return refName ? schema.openapi(refName) : schema;
};

/**
 * One non-2xx entry for a route's `responses` map. Every error response in every
 * route file is this exact shape — the shared `apiErrorSchema` and a description
 * — so it lives here beside the schema rather than being redeclared per file.
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
