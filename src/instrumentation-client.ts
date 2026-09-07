// Browser-side Sentry. Runs after the document loads and before hydration, so a
// crash during hydration is still captured. Options live in `src/lib/sentry.ts`.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry';

Sentry.init(sentryOptions());

/** Ties client-side navigations to the spans they start. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
