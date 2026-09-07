import { Scalar } from '@scalar/hono-api-reference';
import type { Env } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_SITE_NAME } from '@/constants';
import { MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { apiErrorHandler, createRouter } from './create-router';
import { apiError } from './envelope';
import { IMAGE_TOO_LARGE_MESSAGE } from './image-upload';
import { requireAdmin, requireAuth, type AuthedEnv } from './middleware/auth';
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
  productImageUploadHandler,
  productUpdateHandler,
  productUpdateRoute,
} from './routes/admin-products';
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
import { orderDetailHandler, orderDetailRoute } from './routes/orders';
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
const authed = createRouter<Env & AuthedEnv>();
authed.use('/checkout', requireAuth);
// Exact-path mount — `/checkout` above does NOT cover `/checkout/preview`, so
// guard it explicitly (before the route) or the discount preview would be an
// unauthenticated code-enumeration oracle.
authed.use('/checkout/preview', requireAuth);
authed.use('/orders/:id', requireAuth);
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
admin.use(
  '/admin/products/:id/images',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json(apiError(IMAGE_TOO_LARGE_MESSAGE), 413),
  }),
);
// Content image upload shares the same ceiling and refuse-before-buffer guard.
admin.use(
  '/admin/content/images',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json(apiError(IMAGE_TOO_LARGE_MESSAGE), 413),
  }),
);
admin.openapi(productCreateRoute, productCreateHandler);
admin.openapi(productUpdateRoute, productUpdateHandler);
admin.openapi(productDeleteRoute, productDeleteHandler);
admin.post('/admin/products/:id/images', productImageUploadHandler);
// Admin order management (`Story - Admin Orders and Dashboard`): read one order
// (the admin projection) and move it through the state machine. The `/admin/*`
// wildcard guard mounted above already covers these — no new mount needed.
admin.openapi(adminOrderDetailRoute, adminOrderDetailHandler);
admin.openapi(adminOrderTransitionRoute, adminOrderTransitionHandler);
// Admin discount codes (`Story - Discount Codes`): create a code and toggle it
// active/inactive. Same `/admin/*` guard — covered by the wildcard above.
admin.openapi(discountCreateRoute, discountCreateHandler);
admin.openapi(discountToggleRoute, discountToggleHandler);
// Admin storefront content (`Story - Storefront Content Management`): replace one
// block by key, and a shared image upload. Same `/admin/*` guard as above; the
// image path additionally carries the `bodyLimit` mounted earlier. No public
// content GET — the storefront reads through the DAO in its server components.
admin.openapi(contentUpdateRoute, contentUpdateHandler);
admin.post('/admin/content/images', contentImageUploadHandler);
app.route('/', admin);

// OpenAPI document + interactive reference — never expose in production.
if (getEnvVariable(VARS.NODE_ENV, false, '') !== 'production') {
  app.doc('/doc', {
    openapi: '3.0.0',
    info: {
      title: `${DEFAULT_SITE_NAME} API`,
      version: '0.1.0',
    },
  });
  app.get('/reference', Scalar({ url: '/api/doc' }));
}
