import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry';

/**
 * Runs once per server instance — Node and edge alike — before the first
 * request is handled. Both runtimes take the same options, including the
 * privacy ones in `src/lib/sentry.ts`. Nothing here runs on the edge today, but
 * Next compiles that bundle regardless, and an unconfigured runtime is how
 * errors go missing after someone adds a route to it.
 */
export function register() {
  Sentry.init(sentryOptions());
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
