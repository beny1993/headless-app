// @vitest-environment node
// Tracing switched on from the environment. With no `tracesSampleRate` in the
// options, the Node SDK reads SENTRY_TRACES_SAMPLE_RATE at `init` instead, and
// a transaction never passes through `beforeSend`: none of the scrubs in
// `./sentry` reach it, so an admin search URL or a request body rides along.
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sentryOptions } from './sentry';

const Sentry = createRequire(import.meta.url)(
  '@sentry/nextjs',
) as typeof import('@sentry/nextjs');

/** The type of every item the transport was handed, sessions and all. */
const sent: string[] = [];

beforeAll(() => {
  vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '1');
  Sentry.init({
    ...sentryOptions(),
    dsn: 'https://public@example.invalid/1',
    // A local transport: nothing leaves this process.
    transport: () => ({
      send: async (envelope: unknown) => {
        const [, items] = envelope as [unknown, [{ type: string }, unknown][]];
        sent.push(...items.map(([item]) => item.type));
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close(2000);
  vi.unstubAllEnvs();
});

it('sends no transaction when the environment switches tracing on', async () => {
  // The variable took, so this client traces and there is one to send.
  expect(Sentry.getClient()?.getOptions().tracesSampleRate).toBe(1);

  Sentry.startSpan(
    {
      name: 'GET /admin-panel/users',
      op: 'http.server',
      forceTransaction: true,
    },
    () => {},
  );
  await Sentry.flush(2000);

  expect(sent).not.toContain('transaction');
});
