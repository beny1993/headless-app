import { Scalar } from '@scalar/hono-api-reference';
import type { Env } from 'hono';
import { DEFAULT_SITE_NAME } from '@/constants';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { apiErrorHandler, createRouter } from './create-router';
import { requireAdmin, requireAuth, type AuthedEnv } from './middleware/auth';
import {
  categoryListHandler,
  categoryListRoute,
  productDetailHandler,
  productDetailRoute,
  productListHandler,
  productListRoute,
} from './routes/catalog';
import { checkoutHandler, checkoutRoute } from './routes/checkout';
import { healthHandler, healthRoute } from './routes/health';
import { orderDetailHandler, orderDetailRoute } from './routes/orders';
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
authed.use('/orders/:id', requireAuth);
authed.openapi(checkoutRoute, checkoutHandler);
authed.openapi(orderDetailRoute, orderDetailHandler);
app.route('/', authed);

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
