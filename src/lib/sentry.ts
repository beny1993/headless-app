// The one Sentry configuration. Client, Node server and edge all spread this
// object into their own `Sentry.init`, so a privacy decision made here cannot be
// true on one runtime and false on another.
//
// Errors and tracing only. Session replay, logs, profiling and metrics are
// deliberately not enabled: this is a shop for Iranian customers on slow
// connections, and every extra signal is bundle weight and quota for data we
// have no way to read yet (see the sanctions note in `docs/DEPLOY.md`).
import type * as Sentry from '@sentry/nextjs';
import { getEnvVariable, isDevelopmentServer, VARS } from '@/lib/utils/env';

/**
 * `Integration` itself lives in `@sentry/core`, which `@sentry/nextjs` does not
 * re-export and pnpm will not resolve from here. Derive it from the public
 * `getDefaultIntegrations` signature rather than re-declaring the shape.
 */
export type SentryIntegration = ReturnType<
  typeof Sentry.getDefaultIntegrations
>[number];

/**
 * Sentry's own name for the integration that turns every `console.*` call into a
 * breadcrumb attached to the next event. It ships in the Node SDK's defaults.
 *
 * A string comparison against a vendor constant, and the unit test cannot pin it
 * to the SDK's own value: `consoleIntegration` is exported only from the server
 * build, and the suite resolves `@sentry/nextjs` through its browser condition.
 * Verified by hand against @sentry/core 10.73.0
 * (`build/cjs/integrations/console.js`: `const INTEGRATION_NAME = "Console"`).
 * Re-check it on a major SDK bump — a rename upstream turns the filter into a
 * no-op, and a no-op here means one-time codes on their way to Sentry.
 */
export const CONSOLE_INTEGRATION_NAME = 'Console';

/**
 * Removes the console-breadcrumb integration.
 *
 * This is a hard privacy requirement, not a preference. The shipped SMS driver
 * writes **every one-time sign-in code, with the phone number**, to the server
 * log (`[sms:console] to +989… :: کد ورود…`), and the mailer logs recipient
 * addresses. With the Console integration installed, the next error captured
 * after any login carries those lines to Sentry as breadcrumbs.
 *
 * Dropping the integration rather than filtering the messages is the point: a
 * filter only knows about the log lines that existed when it was written, and
 * the next `console.log` someone adds to the auth path would leak silently.
 * Nothing is lost — the container log is still the primary narrative, and every
 * `captureException` in this codebase passes its context explicitly.
 */
export const withoutConsoleBreadcrumbs = (integrations: SentryIntegration[]) =>
  integrations.filter(
    (integration) => integration.name !== CONSOLE_INTEGRATION_NAME,
  );

/**
 * What the SDK is allowed to collect on its own.
 *
 * Every category is set explicitly. `dataCollection` is opt-*out*: passing the
 * object at all — even `{}` — resolves each omitted category to its permissive
 * default (cookies, request bodies and stack-frame locals all `true`), and for a
 * phone-OTP app those three are, respectively, the session cookie, the OTP in
 * the sign-in POST body, and the plaintext code sitting in a local variable.
 *
 * The deprecated `sendDefaultPii: false` would cover the same ground today, but
 * it is removed in SDK v11 — and it is a single switch where this is a list you
 * can audit.
 */
const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  // Not `as const`: `httpBodies` would become a `readonly []`, which the SDK's
  // mutable `HttpBodyCollectionTarget[]` will not accept.
};

/**
 * Shared `Sentry.init` options.
 *
 * A function, not a constant: the DSN and environment are read from `process.env`,
 * and in tests the suite sets them per case.
 */
export function sentryOptions() {
  const dsn = getEnvVariable(VARS.NEXT_PUBLIC_SENTRY_DSN, false, '').trim();

  return {
    // An empty DSN disables the SDK entirely rather than erroring — which is what
    // a developer with no `.env` entry, and every `pnpm test` run, should get.
    // Read through STATIC_INLINED_VARS, so it is baked in at build time for the
    // server as well as the browser: a runtime-only value never arrives.
    dsn: dsn || undefined,
    // Staging and production report into the SAME Sentry project. Without this
    // they are indistinguishable and every staging error reads as a customer
    // hitting a bug. Inlined at build time, so it is a build ARG (docs/DEPLOY.md).
    environment:
      getEnvVariable(VARS.NEXT_PUBLIC_SENTRY_ENVIRONMENT, false, '').trim() ||
      undefined,
    // Everything locally, a tenth in production — tracing is the high-volume
    // signal and the quota is shared with the errors that actually matter.
    tracesSampleRate: isDevelopmentServer() ? 1 : 0.1,
    dataCollection,
    integrations: withoutConsoleBreadcrumbs,
  };
}
