import * as Sentry from '@sentry/nextjs';

/**
 * Runs once per server instance, before the first request is handled. Each
 * runtime gets its own bundle, so the import is conditional rather than static.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * Every server error Next itself catches — Server Component renders, route
 * handlers, Server Actions.
 *
 * It does NOT cover the Hono API: `apiErrorHandler` in
 * `src/lib/hono/create-router.ts` handles those and returns a 500 envelope, so
 * Next never sees a throw. That handler reports separately.
 */
export const onRequestError = Sentry.captureRequestError;
