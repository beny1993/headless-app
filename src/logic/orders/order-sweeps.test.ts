// @vitest-environment node
// The in-server schedule for the order sweeps (started from `register()` in
// src/instrumentation.ts): the card-to-card receipt expiry every run, the
// Zarinpal reconcile only while online payment is on, a failing sweep reported
// and survived, and one schedule per process whose first run comes one
// interval after start — never at boot.
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

const { runOrderSweeps, startOrderSweeps, SWEEP_INTERVAL_MS } =
  await import('./order-sweeps');

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
  it('first runs one interval after start, then every interval — never at boot', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    startOrderSweeps();
    expect(mocks.expireReceiptOrders).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(2);
  });

  it('keeps one schedule per process, however often it is started', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    startOrderSweeps();
    startOrderSweeps();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);

    expect(mocks.expireReceiptOrders).toHaveBeenCalledTimes(1);
  });
});
