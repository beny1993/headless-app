// Sentry for the edge runtime. Nothing in this app runs on the edge today (no
// middleware, no `runtime = 'edge'` route), but Next compiles the edge bundle
// regardless and an unconfigured runtime is how errors go missing after someone
// adds one.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './src/lib/sentry';

Sentry.init(sentryOptions());
