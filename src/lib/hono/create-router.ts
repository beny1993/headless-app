import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { OpenAPIHono } from '@hono/zod-openapi';
import { apiError, formatZodIssues } from './envelope';

/**
 * Factory for all API sub-routers. Installs a `defaultHook` so request-validation
 * failures return the standard `{ status: 'error', message, errors }` envelope at
 * HTTP 400 instead of Hono's built-in `{ success: false, error }` shape.
 *
 * A `defaultHook` is applied at `.openapi()` registration time on the instance the
 * route is registered on. Sub-routers build their own `OpenAPIHono`, so the hook
 * must come from this shared factory — setting it on the main app alone would not
 * cover routes registered on sub-routers.
 *
 * Generic over `E` so sub-routers that need a typed context (e.g. `Variables` set
 * by their own middleware) can call `createRouter<MyEnv>()` and keep that typing.
 */
export const createRouter = <E extends Env = Env>() =>
  new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          apiError('Validation failed', formatZodIssues(result.error)),
          400,
        );
      }
    },
  });

/** An `HTTPException`, structurally. See `isHttpException`. */
type HttpExceptionLike = Error & {
  status: ContentfulStatusCode;
  getResponse: () => Response;
};

/**
 * Duck-typed `HTTPException` check. Deliberately not `instanceof`: the bundle can
 * hold more than one copy of `hono/http-exception` (ours plus the one nested under
 * `@hono/zod-openapi`), and an exception thrown by one copy fails `instanceof`
 * against the other. Hono's own default error handler tests for `getResponse` for
 * exactly this reason.
 */
const isHttpException = (err: Error): err is HttpExceptionLike =>
  'getResponse' in err &&
  typeof (err as HttpExceptionLike).getResponse === 'function' &&
  Number.isInteger((err as HttpExceptionLike).status);

/**
 * Shared `onError` handler. Registering it *replaces* Hono's built-in handler, so
 * it has to reproduce the part of that handler we still want: an `HTTPException`
 * carries its own status and must go out with it. Without that, a client-caused
 * 400 — e.g. Hono's "Malformed JSON in request body" from the json validator —
 * would be answered with 500.
 *
 * Error details (message + stack) are exposed only outside production.
 */
export const apiErrorHandler = (err: Error, c: Context) => {
  if (isHttpException(err) && err.status < 500) {
    console.warn(
      `Client error: ${c.req.method} ${c.req.path} → ${err.status}: ${err.message}`,
    );
    return c.json(apiError(err.message), err.status);
  }

  console.error('Unhandled error:', err);

  const details =
    process.env.NODE_ENV !== 'production'
      ? [err.message, ...(err.stack ? [err.stack] : [])]
      : undefined;
  return c.json(apiError('Internal server error', details), 500);
};
