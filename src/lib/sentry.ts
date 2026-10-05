// The one Sentry configuration. Client, Node server and edge all spread this
// object into their own `Sentry.init`, so a privacy decision made here cannot be
// true on one runtime and false on another.
//
// Errors only. Tracing, session replay, logs, profiling and metrics are
// deliberately not enabled: this is a shop for Iranian customers on slow
// connections, and every extra signal is bundle weight and quota for data we
// have no way to read yet (see the sanctions note in `docs/DEPLOY.md`).
import type * as Sentry from '@sentry/nextjs';
import { stripAdminQuery } from '@/lib/admin-url';
import { RECEIPT_KEY_PREFIX } from '@/lib/storage/image-upload';
import { getEnvVariable, VARS } from '@/lib/utils/env';

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
 * Every category that can hold a customer's data is set explicitly; SDK 10.73.0
 * also has `graphQL`, `genAI` and `frameContextLines`, left at their defaults
 * (no GraphQL or AI client here, and context lines are our own source).
 * `dataCollection` is opt-*out*: passing the object at all — even `{}` —
 * resolves each omitted category to its permissive default (cookies, request
 * bodies and stack-frame locals all `true`), and for a phone-OTP app those
 * three are, respectively, the session cookie, the OTP in the sign-in POST
 * body, and the plaintext code sitting in a local variable.
 *
 * `httpBodies: []` does not keep every body out, though: see
 * {@link withoutRequestBody}.
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
 * Drizzle embeds every bound value in Error.message. SDK collection opt-outs
 * only control instrumentation, so they do not sanitize that message or the
 * PostgreSQL cause (which can repeat a rejected value). Detect structurally:
 * server bundles can contain a different Drizzle constructor from this module.
 */
const containsDatabaseError = (error: unknown): boolean => {
  const seen = new Set<object>();
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    seen.add(error);
    if (
      'query' in error &&
      'params' in error &&
      typeof error.query === 'string' &&
      Array.isArray(error.params)
    ) {
      return true;
    }
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
};

// These are deliberately attached by the payment and API error boundaries so
// an operator can locate the failed operation. Keep only this audited set for a
// database exception; arbitrary extras may contain the same private values as
// the rejected query.
const SAFE_DATABASE_EXTRA_KEYS = new Set([
  'method',
  'path',
  'paymentId',
  'orderId',
  // The new-order alert's only context. A database failure is exactly when
  // knowing which order lost its SMS is worth something.
  'orderNo',
]);

const safeDatabaseExtras = (extra: Sentry.ErrorEvent['extra']) => {
  if (!extra) return undefined;
  const kept = Object.fromEntries(
    Object.entries(extra).filter(
      ([key, value]) =>
        SAFE_DATABASE_EXTRA_KEYS.has(key) &&
        ['string', 'number', 'boolean'].includes(typeof value),
    ),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
};

/** Keep database failure locations while removing values from the entire chain. */
export const sanitizeDatabaseError = (
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): Sentry.ErrorEvent => {
  if (!containsDatabaseError(hint.originalException)) return event;

  // All messages in the chain are unsafe: an outer wrapper may interpolate the
  // original message and a PostgreSQL cause may repeat a constraint value.
  return {
    ...event,
    message: event.message ? 'Database operation failed' : undefined,
    extra: safeDatabaseExtras(event.extra),
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((exception) => ({
            ...exception,
            value: 'Database operation failed',
          })),
        }
      : undefined,
  };
};

/**
 * Admin URLs without their query, wherever the SDK puts a URL on an error.
 *
 * The users search puts a customer's phone or name in an admin page's `?q=`.
 * `urlQueryParams: false` above only drops the separate `query_string`: the SDK
 * still sends the page URL whole as `request.url` (and as `Referer`), and
 * records navigations and fetches, query included, as breadcrumbs. And
 * `onRequestError` (`src/instrumentation.ts`) copies Next's `req.url`, query
 * included, into `contexts.nextjs.request_path`, with or without a `request`.
 */
export const withoutAdminQuery = (
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent => {
  const { request, contexts } = event;
  const nextjs = contexts?.nextjs;
  return {
    ...event,
    ...(request && {
      request: {
        ...request,
        url: request.url && stripAdminQuery(request.url),
        headers:
          request.headers &&
          Object.fromEntries(
            Object.entries(request.headers).map(([name, value]) => [
              name,
              name.toLowerCase() === 'referer' ? stripAdminQuery(value) : value,
            ]),
          ),
      },
    }),
    ...(typeof nextjs?.request_path === 'string' && {
      contexts: {
        ...contexts,
        nextjs: {
          ...nextjs,
          request_path: stripAdminQuery(nextjs.request_path),
        },
      },
    }),
  };
};

/**
 * The event without the HTTP request body the SDK attached to it.
 *
 * `httpBodies: []` above does not stop that: in SDK 10.73.0 the Node `Http`
 * integration records an incoming body read through `req.on('data')` without
 * consulting the list, and the request-data integration attaches it to every
 * event captured in that request, transactions as well as errors
 * (`@sentry/core` `integrations/http/server-subscription.js`,
 * `integrations/requestdata.js`). This reaches only the errors; the
 * transactions are dropped whole by `beforeSendTransaction`. Span streaming
 * (`traceLifecycle: 'stream'`, not set here) would put the body on spans as
 * `http.request.body.data`, where neither reaches.
 */
export const withoutRequestBody = (
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent => {
  if (event.request?.data === undefined) return event;
  const { data: _data, ...request } = event.request;
  return { ...event, request };
};

/**
 * Where a breadcrumb keeps a URL: navigation's `from`/`to`, and the `url` of a
 * fetch or, on the server, of an outgoing `http` request.
 */
const BREADCRUMB_URL_KEYS = new Set(['from', 'to', 'url']);

/** `breadcrumb` with every URL in its data passed through `scrub`. */
const scrubBreadcrumbUrls = (
  breadcrumb: Sentry.Breadcrumb,
  scrub: (url: string) => string,
): Sentry.Breadcrumb =>
  breadcrumb.data
    ? {
        ...breadcrumb,
        data: Object.fromEntries(
          Object.entries(breadcrumb.data).map(([key, value]) => [
            key,
            BREADCRUMB_URL_KEYS.has(key) && typeof value === 'string'
              ? scrub(value)
              : value,
          ]),
        ),
      }
    : breadcrumb;

/** {@link withoutAdminQuery} for a breadcrumb. */
export const withoutAdminQueryBreadcrumb = (
  breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb => scrubBreadcrumbUrls(breadcrumb, stripAdminQuery);

/**
 * A receipt's object key wherever text can carry one: from the first
 * `receipts/` — or `receipts%2F`, or `receipts%252F`, once a redirect has
 * percent-encoded the slash once or twice — to the end of that path, so a
 * bucket or base path itself named `receipts` cannot leave the filename behind;
 * and not only in a URL's path, since a redirect can move the key into a query
 * string, which the SDK files apart from the URL as `http.query`. Any case,
 * and on no word boundary — no lookbehind either: this module ships to the
 * browser, and Safari before 16.4 throws on one — so it over-redacts:
 * `/my-receipts/…` and the app's own `/api/orders/<id>/receipts/<id>` lose
 * their tails too, which is harmless.
 */
const RECEIPT_KEY = new RegExp(
  `(${RECEIPT_KEY_PREFIX}(?:/|%2F|%252F))[^?#&\\s"'<>]+`,
  'gi',
);

/**
 * `text` with each receipt key replaced: `receipts/[redacted]`, or
 * `receipts%2F[redacted]` / `receipts%252F[redacted]` behind an encoded slash.
 */
const withoutReceiptKey = (text: string): string =>
  text.replace(RECEIPT_KEY, '$1[redacted]');

/**
 * A breadcrumb with no receipt key in its message or in any top-level string
 * of its data: the Node SDK records the s3 driver's own requests as `http`
 * breadcrumbs carrying the key. Which request's scope one lands on depends on
 * the client. The put and the delete go through the AWS SDK's `node:http`,
 * whose `Agent.addRequest` resets a reused socket's async context, so they
 * land on the caller's. The anonymous probe is a `fetch`, and undici resets
 * nothing, so each of its hops — the first as well as a redirect's — lands on
 * the scope of whichever request opened the kept-alive socket its response
 * came back on, and goes out with whatever event that request captures. Each
 * is scrubbed as it is added, so no event carries the key, whichever one it is.
 */
export const withoutReceiptKeyBreadcrumb = (
  breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb => ({
  ...breadcrumb,
  // Strings only: a breadcrumb is any library's to add, and a filter that
  // throws on an odd one throws to whoever called `addBreadcrumb`.
  ...(typeof breadcrumb.message === 'string' && {
    message: withoutReceiptKey(breadcrumb.message),
  }),
  ...(breadcrumb.data && {
    data: Object.fromEntries(
      Object.entries(breadcrumb.data).map(([key, value]) => [
        key,
        typeof value === 'string' ? withoutReceiptKey(value) : value,
      ]),
    ),
  }),
});

/**
 * An event with no receipt key in its message or in any exception's value. A
 * storage error can quote the object it refused — AWS's AccessDenied names it
 * (`…on resource: "arn:aws:s3:::<bucket>/receipts/<key>"`) — and a failed
 * GetObject reaches Sentry whole: `s3Driver.get` rethrows every failure but
 * `NoSuchKey`, `readReceipt` lets it through, and the API's error boundary
 * (`apiErrorHandler`) captures it.
 */
export const withoutReceiptKeyEvent = (
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent => ({
  ...event,
  ...(typeof event.message === 'string' && {
    message: withoutReceiptKey(event.message),
  }),
  ...(event.exception?.values && {
    exception: {
      ...event.exception,
      values: event.exception.values.map((exception) =>
        typeof exception.value !== 'string'
          ? exception
          : { ...exception, value: withoutReceiptKey(exception.value) },
      ),
    },
  }),
});

/**
 * An element's screen-reader text, as the browser SDK writes it into a `ui.*`
 * breadcrumb's element path: `body > a.view[aria-label="…"]`. The users list
 * labels each row's view link with the customer's name and phone number, the
 * pets tab labels its buttons with a pet's name, the addresses tab with an
 * address title. The SDK writes the value unescaped, so a `"]` inside it cannot
 * be told from its end: everything from the first such attribute on is
 * dropped, the rest of the path with it, and only the attribute's name stays.
 */
const SCREEN_READER_TEXT = /\[(aria-label|title|alt)="[\s\S]*$/;

/** A `ui.*` breadcrumb without its {@link SCREEN_READER_TEXT}. */
export const withoutScreenReaderText = (
  breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb =>
  typeof breadcrumb.category === 'string' &&
  breadcrumb.category.startsWith('ui.') &&
  typeof breadcrumb.message === 'string'
    ? {
        ...breadcrumb,
        message: breadcrumb.message.replace(SCREEN_READER_TEXT, '[$1]'),
      }
    : breadcrumb;

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
    // Tags each event with the deployment it came from. Only production reports
    // (staging leaves the DSN unset, docs/DEPLOY.md §9), so this is `production`
    // there and empty elsewhere. Inlined at build time, so it is a build ARG.
    environment:
      getEnvVariable(VARS.NEXT_PUBLIC_SENTRY_ENVIRONMENT, false, '').trim() ||
      undefined,
    // Errors only, and not because `tracesSampleRate` is absent: without it the
    // Node and edge SDKs read SENTRY_TRACES_SAMPLE_RATE from the environment
    // (`@sentry/node-core` `sdk/index.js`, `@sentry/vercel-edge`), so one
    // deploy variable switches tracing on. `beforeSendTransaction` below is
    // what keeps transactions out. The backend is GlitchTip (docs/DEPLOY.md
    // §9), whose performance support is partial — and transactions are the
    // high-volume signal, so enabling them spends a shared event quota on data
    // nobody here reads. Errors are the whole point.
    dataCollection,
    // The receipt-key scrub last, over whatever the others leave.
    beforeSend: (event: Sentry.ErrorEvent, hint: Sentry.EventHint) =>
      withoutReceiptKeyEvent(
        withoutRequestBody(
          withoutAdminQuery(sanitizeDatabaseError(event, hint)),
        ),
      ),
    // Every transaction dropped, whatever the sample rate. A transaction never
    // passes `beforeSend`, so an admin search URL or a request body would ride
    // on one past every scrub above.
    beforeSendTransaction: () => null,
    // Console breadcrumbs go whole, in the browser too, whose `Breadcrumbs`
    // integration keeps them: Next logs a failed navigation's RSC fetch with
    // its full URL, admin search included. Whole, for the reason the server
    // drops its Console integration (`withoutConsoleBreadcrumbs`): a filter
    // only knows the log lines that existed when it was written.
    //
    // The screen-reader cut before the receipt-key scrub: the scrub's run
    // does not stop at `[`, so it would eat the `[aria-label="` the cut keys
    // on whenever a class or id holds `receipts/`, and the label would leak.
    beforeBreadcrumb: (breadcrumb: Sentry.Breadcrumb) =>
      breadcrumb.category === 'console'
        ? null
        : withoutReceiptKeyBreadcrumb(
            withoutScreenReaderText(withoutAdminQueryBreadcrumb(breadcrumb)),
          ),
    integrations: withoutConsoleBreadcrumbs,
  };
}
