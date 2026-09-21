// `z` from `zod`, not from `@hono/zod-openapi` — see the note in ../envelope.ts.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { z } from 'zod';
import { HealthDao } from '@/db/dao/HealthDao';
import { assertMockGatewayAllowed } from '@/lib/zarinpal/client';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
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
 *
 * It is also where the simulated payment gateway is refused: a production build
 * still on `mock` answers 503 here, so Coolify never routes traffic to a
 * container that would settle every order as paid for zero Toman. That check
 * runs before the database probe — it is pure environment, so there is no point
 * spending I/O first — and it fires whatever APP_CONFIG_ZARINPAL_ENABLED says.
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
    503: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'A dependency is unreachable — do not route traffic here',
    },
  },
});

export const readinessHandler: RouteHandler<typeof readinessRoute> = async (
  c,
) => {
  try {
    assertMockGatewayAllowed();
    await HealthDao.ping();
  } catch (error) {
    // Deliberately not reported to Sentry: a probe runs on a fixed interval, so
    // a database outage would emit an event every tick and bury everything else.
    // The unhealthy container is itself the signal.
    //
    // It does go to the server log, though, and that is not optional: the
    // response is the generic Persian 503 because `/api/ready` is public, so
    // without this line a refusal is unreadable. `assertMockGatewayAllowed`
    // logs its own refusal once, but it resolves the provider FIRST — an
    // unrecognized APP_CONFIG_ZARINPAL_PROVIDER throws before that line is ever
    // reached, which is exactly the deploy that would otherwise roll back blind.
    console.error('[ready] refusing traffic:', error);
    return c.json(apiError(NOT_READY_MESSAGE), 503);
  }

  return c.json(
    apiSuccess({ status: 'ready' as const, database: 'up' as const }),
    200,
  );
};
