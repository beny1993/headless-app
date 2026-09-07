// Sentry for the Node server runtime. Loaded by `src/instrumentation.ts`'s
// `register()` when NEXT_RUNTIME is "nodejs". Options — including the privacy
// ones this app depends on — live in `src/lib/sentry.ts`.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './src/lib/sentry';

Sentry.init(sentryOptions());
