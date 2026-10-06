import { Scalar } from '@scalar/hono-api-reference';
import type { Env } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_SITE_NAME } from '@/constants';
import { MAX_RECEIPT_BYTES } from '@/lib/orders/receipt';
import { MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { isProductionServer } from '@/lib/utils/env';
import { apiErrorHandler, createRouter } from './create-router';
import { apiError } from './envelope';
import { IMAGE_TOO_LARGE_MESSAGE } from './image-upload';
import { requireAdmin, requireAuth, type AuthedEnv } from './middleware/auth';
import { rateLimit, RATE_LIMITED_MESSAGE } from './middleware/rate-limit';
import {
  categoryCreateHandler,
  categoryCreateRoute,
  categoryDeleteHandler,
  categoryDeleteRoute,
  categoryUpdateHandler,
  categoryUpdateRoute,
} from './routes/admin-categories';
import {
  discountCreateHandler,
  discountCreateRoute,
  discountToggleHandler,
  discountToggleRoute,
} from './routes/admin-discounts';
import {
  adminOrderDetailHandler,
  adminOrderDetailRoute,
  adminOrderTransitionHandler,
  adminOrderTransitionRoute,
} from './routes/admin-orders';
import {
  contentImageUploadHandler,
  contentUpdateHandler,
  contentUpdateRoute,
} from './routes/admin-content';
import {
  productCreateHandler,
  productCreateRoute,
  productDeleteHandler,
  productDeleteRoute,
  productImagesOrderHandler,
  productImagesOrderRoute,
  productImageUploadHandler,
  productUpdateHandler,
  productUpdateRoute,
} from './routes/admin-products';
import {
  provinceBulkFeeHandler,
  provinceBulkFeeRoute,
  provinceCreateHandler,
  provinceCreateRoute,
  provinceToggleHandler,
  provinceToggleRoute,
} from './routes/admin-provinces';
import {
  categoryListHandler,
  categoryListRoute,
  productDetailHandler,
  productDetailRoute,
  productListHandler,
  productListRoute,
} from './routes/catalog';
import {
  checkoutHandler,
  checkoutPreviewHandler,
  checkoutPreviewRoute,
  checkoutRoute,
} from './routes/checkout';
import { healthHandler, healthRoute } from './routes/health';
import { readinessHandler, readinessRoute } from './routes/readiness';
import {
  meAddressCreateHandler,
  meAddressCreateRoute,
  meAddressDeleteHandler,
  meAddressDeleteRoute,
  meAddressUpdateHandler,
  meAddressUpdateRoute,
  meAddressesListHandler,
  meAddressesListRoute,
} from './routes/me-addresses';
import { meOrdersHandler, meOrdersRoute } from './routes/me-orders';
import {
  mePetCreateHandler,
  mePetCreateRoute,
  mePetDeleteHandler,
  mePetDeleteRoute,
  mePetUpdateHandler,
  mePetUpdateRoute,
  mePetsListHandler,
  mePetsListRoute,
} from './routes/me-pets';
import {
  orderCancelHandler,
  orderCancelRoute,
  orderDetailHandler,
  orderDetailRoute,
} from './routes/orders';
import {
  adminOrderReceiptHandler,
  orderReceiptHandler,
  orderReceiptUploadGate,
  orderReceiptUploadHandler,
} from './routes/receipts';
import {
  mockCompleteHandler,
  mockGatewayHandler,
  paymentCallbackHandler,
  paymentRequestHandler,
  paymentRequestRoute,
  reconcileHandler,
  reconcileRoute,
} from './routes/payments';
import {
  shippingRateUpdateHandler,
  shippingRateUpdateRoute,
  shippingRatesHandler,
  shippingRatesRoute,
} from './routes/shipping';

// Create the main OpenAPI Hono app, bridged into Next at
// src/app/api/[[...route]]/route.ts. Register new sub-routers with
// `app.route('/', myRoutes)` — build them with `createRouter()` so
// validation failures share the standard error envelope.
export const app = createRouter().basePath('/api');

app.onError(apiErrorHandler);

// The ONE legitimate `app.use('*')` on this app. The convention documented
// further down (see the `authed` sub-router) forbids the wildcard for AUTHZ,
// where it would leak a guard onto public routes. A rate limit is the opposite
// case: it must cover every route, and the public ones most of all — those are
// the ones an unauthenticated caller can spend.
//
// Position is load-bearing, and NOT interchangeable with "before
// `app.route('/', authed)`". Hono runs a wildcard only for routes registered
// AFTER it, so mounting this any later would leave the public catalogue and the
// Zarinpal callback — the two costliest routes per call, and the reason this
// exists — silently uncovered, with every test still green.
app.use('*', rateLimit);

app.openapi(healthRoute, healthHandler);
// Readiness sits beside liveness: `/health` says the process is up, `/ready`
// says it can actually serve (Postgres reachable AND migrated). Container and
// load-balancer probes belong on `/ready`.
app.openapi(readinessRoute, readinessHandler);

// Public storefront catalog — read-only, no auth. Order matters only for
// readability here; Hono matches `/products/{slug}` and `/products` distinctly.
app.openapi(categoryListRoute, categoryListHandler);
app.openapi(productListRoute, productListHandler);
app.openapi(productDetailRoute, productDetailHandler);

// Province shipping rates. The listing and the ?province= fee preview are public
// (checkout shows the fee before the customer signs in); the rate update is
// admin-only. `requireAdmin` is mounted on the `{provinceId}` sub-path so it
// guards the PUT without touching the public GET at `/shipping/rates`, and is
// registered before the route so it runs first — authorize before parsing the
// body.
app.openapi(shippingRatesRoute, shippingRatesHandler);
app.use('/shipping/rates/:provinceId', requireAdmin);
app.openapi(shippingRateUpdateRoute, shippingRateUpdateHandler);

// Zarinpal payments. The callback is unauthenticated by design (a browser
// redirect from the gateway; it settles only via the stored authority + amount +
// CAS — see ./routes/payments.ts). The mock-gateway/complete routes back the
// dev-only mock gateway and 404 unless the provider is `mock`. Reconcile is
// admin-only: `requireAdmin` is mounted before the route so the guard runs first.
// The auth'd request endpoint is on the `authed` sub-router below.
app.get('/payments/zarinpal/callback', paymentCallbackHandler);
app.get('/payments/zarinpal/mock-gateway', mockGatewayHandler);
app.post('/payments/zarinpal/mock-complete', mockCompleteHandler);
app.use('/payments/zarinpal/reconcile', requireAdmin);
app.openapi(reconcileRoute, reconcileHandler);

// Authenticated customer routes — create an order, and read your own orders. They
// live on a dedicated sub-router typed with the session user (so `c.get('user')`
// is typed in the handlers) built from the shared `createRouter` factory (so the
// validation defaultHook still returns the standard error envelope). `requireAuth`
// is mounted per exact path — never `app.use('*')`, which would leak onto the
// public catalog/shipping routes when the sub-router merges into the parent — and
// registered before each route so the guard runs first, authorizing before the
// body is parsed. Every read inside is owner-scoped by the session id, never the
// URL (see ./routes/orders.ts and src/logic/checkout/get-order.ts).
/**
 * What a multipart body adds around the file itself: the boundaries and the
 * part headers, the file's name among them. Generous — a few hundred bytes is
 * typical — because the limit is only the refuse-before-buffering guard; the
 * exact ceiling is the file's own length, checked in `readImageUpload`.
 */
const MULTIPART_ENVELOPE_BYTES = 16 * 1024;

const authed = createRouter<Env & AuthedEnv>();
authed.use('/checkout', requireAuth);
// Exact-path mount — `/checkout` above does NOT cover `/checkout/preview`, so
// guard it explicitly (before the route) or the discount preview would be an
// unauthenticated code-enumeration oracle.
authed.use('/checkout/preview', requireAuth);
// One order and everything under it — the owner's read and the card-to-card
// receipts (the upload, and the owner's read of one). A wildcard, the `/me/*`
// way: nothing public lives under an order, and a receipt route that slipped
// past the guard would be serving someone's bank details. Hono's `/:id/*` also
// matches `/:id` itself, so this one mount guards the order read too — an exact
// mount beside it would look the session up twice.
authed.use('/orders/:id/*', requireAuth);
authed.use('/payments/zarinpal/request', requireAuth);
// The `/me/*` family (order history + owner-scoped pet/address CRUD) is entirely
// authenticated, so one wildcard mount guards it — legible as "everything under
// /me needs a session" and safe in a way `app.use('*')` is not: nothing public
// lives under `/me`, and this is on the `authed` sub-router, not the parent app,
// so it cannot reach the catalog/shipping routes. Registered before the routes so
// the guard runs first. Every handler still scopes by `c.get('user').id`.
authed.use('/me/*', requireAuth);
authed.openapi(checkoutRoute, checkoutHandler);
authed.openapi(checkoutPreviewRoute, checkoutPreviewHandler);
authed.openapi(orderDetailRoute, orderDetailHandler);
authed.openapi(orderCancelRoute, orderCancelHandler);
// The upload, in the order that keeps a refused body unread: the session
// guard (the wildcard above), then who owns the order and whether it takes a
// receipt, then the body limit — which reads a body with no Content-Length in
// full before it lets the request on — and only then the handler. The limit
// allows the multipart envelope on top of the file; `readImageUpload` holds
// the file itself to exactly MAX_RECEIPT_BYTES.
authed.post(
  '/orders/:id/receipts',
  orderReceiptUploadGate,
  bodyLimit({
    maxSize: MAX_RECEIPT_BYTES + MULTIPART_ENVELOPE_BYTES,
    onError: (c) => c.json(apiError(IMAGE_TOO_LARGE_MESSAGE), 413),
  }),
  orderReceiptUploadHandler,
);
authed.get('/orders/:id/receipts/:receiptId', orderReceiptHandler);
authed.openapi(paymentRequestRoute, paymentRequestHandler);
authed.openapi(meOrdersRoute, meOrdersHandler);
authed.openapi(mePetsListRoute, mePetsListHandler);
authed.openapi(mePetCreateRoute, mePetCreateHandler);
authed.openapi(mePetUpdateRoute, mePetUpdateHandler);
authed.openapi(mePetDeleteRoute, mePetDeleteHandler);
authed.openapi(meAddressesListRoute, meAddressesListHandler);
authed.openapi(meAddressCreateRoute, meAddressCreateHandler);
authed.openapi(meAddressUpdateRoute, meAddressUpdateHandler);
authed.openapi(meAddressDeleteRoute, meAddressDeleteHandler);
app.route('/', authed);

// Admin product CRUD (`Story - Admin Product Management`). Its own sub-router so
// the admin guard can be a single wildcard mount — `admin.use('/admin/*',
// requireAdmin)` — the way `/me/*` is: nothing public lives under `/admin`, and
// `app.use` is method-agnostic, so guarding `/products/:id` directly would also
// 403 the public `GET /products/{slug}`. The guard is registered first so it runs
// before every handler (authorize before the body is parsed or buffered). The
// image upload additionally carries a `bodyLimit` so an oversize body is refused
// before it is read into memory; it is registered after the guard, so an
// unauthenticated caller is turned away before anything is buffered.
const admin = createRouter<Env & AuthedEnv>();
admin.use('/admin/*', requireAdmin);
const imageBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES,
  onError: (c) => c.json(apiError(IMAGE_TOO_LARGE_MESSAGE), 413),
});
admin.use('/admin/products/:id/images', imageBodyLimit);
// Content image upload shares the same ceiling and refuse-before-buffer guard.
admin.use('/admin/content/images', imageBodyLimit);
admin.openapi(productCreateRoute, productCreateHandler);
admin.openapi(productUpdateRoute, productUpdateHandler);
admin.openapi(productDeleteRoute, productDeleteHandler);
admin.post('/admin/products/:id/images', productImageUploadHandler);
// The gallery order — a JSON body on the same path, so the `bodyLimit` above
// covers it too (harmlessly: five keys are nowhere near the image ceiling).
admin.openapi(productImagesOrderRoute, productImagesOrderHandler);
// Admin order management (`Story - Admin Orders and Dashboard`): read one order
// (the admin projection) and move it through the state machine. The `/admin/*`
// wildcard guard mounted above already covers these — no new mount needed.
admin.openapi(adminOrderDetailRoute, adminOrderDetailHandler);
admin.openapi(adminOrderTransitionRoute, adminOrderTransitionHandler);
// A card-to-card receipt, for the admin checking it — the same bytes and
// headers as the owner's route, behind the same `/admin/*` guard.
admin.get('/admin/orders/:id/receipts/:receiptId', adminOrderReceiptHandler);
// Admin discount codes (`Story - Discount Codes`): create a code and toggle it
// active/inactive. Same `/admin/*` guard — covered by the wildcard above.
admin.openapi(discountCreateRoute, discountCreateHandler);
admin.openapi(discountToggleRoute, discountToggleHandler);
// Admin province management (`Story - Admin Province Management`): add a province
// and deactivate/reactivate one. Same `/admin/*` guard — covered by the wildcard
// above. One province's fee stays on `PUT /shipping/rates/{provinceId}`; the
// one-fee-for-all `PUT /admin/provinces/fee` is here, under the wildcard guard.
admin.openapi(provinceCreateRoute, provinceCreateHandler);
admin.openapi(provinceToggleRoute, provinceToggleHandler);
admin.openapi(provinceBulkFeeRoute, provinceBulkFeeHandler);
// Admin categories (`Story - Admin Category Management`): create, update and
// delete. Same `/admin/*` guard — covered by the wildcard above, so no new mount,
// and the public `GET /categories` stays outside it.
admin.openapi(categoryCreateRoute, categoryCreateHandler);
admin.openapi(categoryUpdateRoute, categoryUpdateHandler);
admin.openapi(categoryDeleteRoute, categoryDeleteHandler);
// Admin storefront content (`Story - Storefront Content Management`): replace one
// block by key, and a shared image upload. Same `/admin/*` guard as above; the
// image path additionally carries the `bodyLimit` mounted earlier. No public
// content GET — the storefront reads through the DAO in its server components.
admin.openapi(contentUpdateRoute, contentUpdateHandler);
admin.post('/admin/content/images', contentImageUploadHandler);
app.route('/', admin);

/**
 * The 429 the rate limiter can return from ANY route, declared once and
 * attached to every operation when the document is generated (below).
 */
const RATE_LIMITED_RESPONSE = {
  description:
    'Rate limit exceeded for this caller. Carries a `Retry-After` header ' +
    'with the seconds to wait. The Zarinpal callback answers a 302 to the ' +
    'payment failure page instead, since a browser is what arrives there.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['error'] },
          message: { type: 'string', example: RATE_LIMITED_MESSAGE },
        },
        required: ['status', 'message'],
      },
    },
  },
} as const;

// OpenAPI document + interactive reference — never expose in production.
if (!isProductionServer()) {
  // Served by hand rather than with `app.doc`, so the 429 every route can now
  // answer is documented in ONE place. The limiter is middleware over the whole
  // app, so declaring it per route would be 35 identical copies that drift the
  // first time one is added without it — and a route file cannot know it is
  // limited. Post-processing the generated document keeps it true for routes
  // that do not exist yet.
  app.get('/doc', (c) => {
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: {
        title: `${DEFAULT_SITE_NAME} API`,
        version: '0.1.0',
      },
    });

    for (const path of Object.values(document.paths ?? {})) {
      for (const operation of Object.values(path ?? {})) {
        if (
          typeof operation !== 'object' ||
          operation === null ||
          !('responses' in operation)
        ) {
          continue;
        }
        (operation.responses as Record<string, unknown>)[429] =
          RATE_LIMITED_RESPONSE;
      }
    }

    return c.json(document);
  });
  app.get('/reference', Scalar({ url: '/api/doc' }));
}
