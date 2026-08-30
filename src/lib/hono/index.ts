import { Scalar } from '@scalar/hono-api-reference';
import { DEFAULT_SITE_NAME } from '@/constants';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { apiErrorHandler, createRouter } from './create-router';
import { healthHandler, healthRoute } from './routes/health';

// Create the main OpenAPI Hono app, bridged into Next at
// src/app/api/[[...route]]/route.ts. Register new sub-routers with
// `app.route('/', myRoutes)` — build them with `createRouter()` so
// validation failures share the standard error envelope.
export const app = createRouter().basePath('/api');

app.onError(apiErrorHandler);

app.openapi(healthRoute, healthHandler);

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
