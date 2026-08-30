import { z } from '@hono/zod-openapi';
import type { ZodError } from 'zod';

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
