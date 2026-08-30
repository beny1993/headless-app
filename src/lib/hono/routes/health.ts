import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { apiSuccess, apiSuccessSchema } from '../envelope';

// Route pattern: always split into a `createRoute` definition and a separate
// typed `RouteHandler` export in the same file — never inline the handler into
// `app.openapi()`.

const HealthData = z
  .object({
    status: z.literal('ok'),
    timestamp: z.string(),
  })
  .openapi('HealthData');

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(HealthData, 'HealthResponse'),
        },
      },
      description: 'Service is up',
    },
  },
});

export const healthHandler: RouteHandler<typeof healthRoute> = (c) =>
  c.json(
    apiSuccess({ status: 'ok' as const, timestamp: new Date().toISOString() }),
    200,
  );
