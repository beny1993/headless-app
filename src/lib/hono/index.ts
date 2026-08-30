import { Scalar } from '@scalar/hono-api-reference';
import { DEFAULT_SITE_NAME } from '@/constants';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { apiErrorHandler, createRouter } from './create-router';
import {
  categoryListHandler,
  categoryListRoute,
  productDetailHandler,
  productDetailRoute,
  productListHandler,
  productListRoute,
} from './routes/catalog';
import { healthHandler, healthRoute } from './routes/health';

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
