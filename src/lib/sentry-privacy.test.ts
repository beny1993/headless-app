// @vitest-environment node
import { createRequire } from 'node:module';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sentryOptions } from './sentry';

// Exercise the installed Node SDK's serialization, including linked causes.
const Sentry = createRequire(import.meta.url)(
  '@sentry/nextjs',
) as typeof import('@sentry/nextjs');

let captured: string | undefined;
beforeAll(() => {
  const options = sentryOptions();
  Sentry.init({
    ...options,
    dsn: 'https://public@example.invalid/1',
    integrations: (defaults) =>
      options
        .integrations(defaults)
        .filter((integration) => integration.name !== 'ContextLines'),
    // A local transport: no events leave this process.
    transport: () => ({
      send: async (envelope: unknown) => {
        captured = JSON.stringify(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close(2000);
});
async function capture(error: Error, extra?: Record<string, unknown>) {
  captured = undefined;
  Sentry.captureException(error, { extra });
  await Sentry.flush(2000);
  expect(captured).toBeDefined();
  return captured!;
}

describe('database exception privacy', () => {
  it('removes query parameters and PostgreSQL cause values from the serialized event', async () => {
    const error = new DrizzleQueryError(
      'insert into addresses values ($1, $2)',
      ['PRIVATE_PHONE', 'PRIVATE_POSTAL_ADDRESS'],
      new Error('Key (phone)=(PRIVATE_PHONE) already exists.'),
    );
    const event = await capture(error);
    expect(event).not.toContain('PRIVATE_PHONE');
    expect(event).not.toContain('PRIVATE_POSTAL_ADDRESS');
    expect(event).toContain('Database operation failed');
    expect(event).toContain('stacktrace');
  });

  it('recognizes a database error nested under an application error', async () => {
    const event = await capture(
      new Error('Could not save PRIVATE_ADDRESS', {
        cause: new DrizzleQueryError('insert into addresses values ($1)', [
          'PRIVATE_ADDRESS',
        ]),
      }),
    );
    expect(event).not.toContain('PRIVATE_ADDRESS');
    expect(event).toContain('Database operation failed');
  });

  it('keeps safe payment correlation ids while dropping arbitrary extras', async () => {
    const event = await capture(
      new DrizzleQueryError('update payments set status = $1', [
        'PRIVATE_VALUE',
      ]),
      {
        paymentId: 'safe-payment-id',
        orderId: 'safe-order-id',
        params: ['PRIVATE_VALUE'],
      },
    );
    expect(event).toContain('safe-payment-id');
    expect(event).toContain('safe-order-id');
    expect(event).not.toContain('PRIVATE_VALUE');
  });

  it('preserves ordinary error diagnostics', async () => {
    expect(await capture(new Error('Ordinary failure'))).toContain(
      'Ordinary failure',
    );
  });
});
