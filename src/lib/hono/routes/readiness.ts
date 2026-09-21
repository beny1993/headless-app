// `z` from `zod`, not from `@hono/zod-openapi` — see the note in ../envelope.ts.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { z } from 'zod';
import { HealthDao } from '@/db/dao/HealthDao';
import {
  apiError,
  apiSuccess,
  apiSuccessSchema,
  errorResponse,
} from '../envelope';

// Route pattern: always split into a `createRoute` definition and a separate
// typed `RouteHandler` export in the same file — never inline the handler into
// `app.openapi()`.

/**
 * Readiness, as distinct from `/health` liveness.
 *
 * `/health` answers "is this process running" and touches nothing, so it returns
 * 200 even when the database is unreachable — during one staging deploy it would
 * have reported healthy while every page 500'd. This one answers "can this
 * instance actually serve traffic", which for this app means Postgres is
 * reachable and migrated. Point orchestrator probes here, not at `/health`.
 */

export const NOT_READY_MESSAGE = 'سرویس آماده نیست';

const ReadinessData = z
  .object({
    status: z.literal('ready'),
    database: z.literal('up'),
  })
  .openapi('ReadinessData');

export const readinessRoute = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['system'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(ReadinessData, 'ReadinessResponse'),
        },
      },
      description: 'Dependencies reachable — safe to route traffic here',
    },
    503: errorResponse(
      'A dependency is unreachable — do not route traffic here',
    ),
  },
});

export const readinessHandler: RouteHandler<typeof readinessRoute> = async (
  c,
) => {
  try {
    await HealthDao.ping();
  } catch {
    // Deliberately not reported to Sentry: a probe runs on a fixed interval, so
    // a database outage would emit an event every tick and bury everything else.
    // The unhealthy container is itself the signal.
    return c.json(apiError(NOT_READY_MESSAGE), 503);
  }

  return c.json(
    apiSuccess({ status: 'ready' as const, database: 'up' as const }),
    200,
  );
};
