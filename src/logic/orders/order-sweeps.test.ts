// @vitest-environment node
// The in-server schedule for the order sweeps (started from `register()` in
// src/instrumentation.ts): the card-to-card receipt expiry every run, the
// Zarinpal reconcile only while online payment is on, a failing sweep reported
// and survived, and one schedule per process whose first run comes
// FIRST_SWEEP_DELAY_MS after start — never at boot — then every interval.
//
// The sweeps themselves are mocked at the module edge; their own integration
// tests prove what they do to orders.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expireReceiptOrders: vi.fn(),
  reconcilePayments: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@/logic/orders/expire-receipt-orders', () => ({
  expireReceiptOrders: mocks.expireReceiptOrders,
}));
vi.mock('@/logic/payments/reconcile', () => ({
  reconcilePayments: mocks.reconcilePayments,
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}));

const {
  FIRST_SWEEP_DELAY_MS,
  runOrderSweeps,
  startOrderSweeps,
  SWEEP_INTERVAL_MS,
} = await import('./order-sweeps');

/** Only the timers the schedule uses: faking React's or the runner's is flaky. */
const fakeScheduleTimers = () =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.expireReceiptOrders.mockResolvedValue(0);
  mocks.reconcilePayments.mockResolvedValue({
    verified: 0,
    failed: 0,
    refundFlagged: 0,
    expired: 0,
    errored: 0,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The once-per-process guard lives on globalThis; each test starts clean.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('smokey-shop.order-sweeps')
  ];
});

describe('runOrderSweeps', () => {
  it('expires card-to-card orders and leaves Zarinpal alone while online payment is off', async () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', '');

    await runOrderSweeps();

    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayments).not.toHaveBeenCalled();
  });

  it('runs the Zarinpal reconcile too while online payment is on', async () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'true');

    await runOrderSweeps();

    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayments).toHaveBeenCalledTimes(1);
  });

  it('reports a failing sweep, runs the other, and never throws', async () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_ENABLED', 'true');
    const failure = new Error('database unreachable');
    mocks.expireReceiptOrders.mockRejectedValue(failure);

    await expect(runOrderSweeps()).resolves.toBeUndefined();

    expect(mocks.captureException).toHaveBeenCalledWith(failure);
    expect(mocks.reconcilePayments).toHaveBeenCalledTimes(1);
  });
});

describe('startOrderSweeps', () => {
  it('checks every five minutes, so a half-hour wait ends within 35 minutes', () => {
    expect(SWEEP_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('first runs a quarter of an hour after start, then every interval — never at boot', async () => {
    fakeScheduleTimers();

    startOrderSweeps();
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS - 1);
    expect(mocks.expireReceiptOrders).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(3);
  });

  it('keeps one schedule per process, however often it is started', async () => {
    fakeScheduleTimers();

    startOrderSweeps();
    startOrderSweeps();
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);

    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);
  });
});
