// @vitest-environment node
// Pins the startup wiring in `register()`: the order sweeps start on the Node
// server only — never in the edge runtime, never during `next build` — and
// always after Sentry, so a sweep's report has somewhere to go. Nothing else
// tests this: delete the wiring and every sweep test still passes.
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@sentry/nextjs', () => ({
  init: () => calls.push('sentry'),
  captureRequestError: vi.fn(),
}));
vi.mock('@/lib/sentry', () => ({ sentryOptions: () => ({}) }));
vi.mock('@/logic/orders/order-sweeps', () => ({
  startOrderSweeps: () => calls.push('sweeps'),
}));

const { register } = await import('./instrumentation');

afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
});

describe('register', () => {
  it('starts the order sweeps on the Node server, after Sentry', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');

    await register();

    expect(calls).toEqual(['sentry', 'sweeps']);
  });

  it('never starts them in the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    await register();

    expect(calls).toEqual(['sentry']);
  });

  it('never starts them during next build, which has no database', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');

    await register();

    expect(calls).toEqual(['sentry']);
  });
});
