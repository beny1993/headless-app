// The seam and the mock driver — pure, no database, so this runs on the DB-less
// path too. The real HTTP driver has its own suite (zarinpal-driver.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getZarinpalClient,
  getZarinpalProvider,
  mockDriver,
  mockLedger,
  ZARINPAL_CURRENCY,
} from '@/lib/zarinpal/client';

describe('ZARINPAL_CURRENCY', () => {
  it('is IRT (Toman) — the pin that keeps amounts conversion-free', () => {
    // A stray edit to 'IRR' (Rial) would silently 10× every charge. If this
    // fails, the amount unit changed; do not "fix" the test — fix the constant.
    expect(ZARINPAL_CURRENCY).toBe('IRT');
  });
});

describe('mock driver', () => {
  afterEach(() => mockLedger.reset());

  it('mints a mock- authority and a redirect to the mock gateway page', async () => {
    const { authority, redirectUrl } = await mockDriver.requestPayment({
      amountToman: 340_000,
      callbackUrl: 'http://localhost:3000/api/payments/zarinpal/callback',
      description: 'سفارش آزمایشی',
      orderId: crypto.randomUUID(),
    });

    expect(authority.startsWith('mock-')).toBe(true);
    expect(redirectUrl).toContain('/api/payments/zarinpal/mock-gateway');
    expect(redirectUrl).toContain(encodeURIComponent(authority));
  });

  it('mints a distinct authority per attempt (retries need unique keys)', async () => {
    const orderId = crypto.randomUUID();
    const a = await mockDriver.requestPayment({
      amountToman: 1000,
      callbackUrl: 'x',
      description: 'y',
      orderId,
    });
    const b = await mockDriver.requestPayment({
      amountToman: 1000,
      callbackUrl: 'x',
      description: 'y',
      orderId,
    });
    expect(a.authority).not.toBe(b.authority);
  });

  it('verify fails for an authority the ledger never marked paid', async () => {
    const result = await mockDriver.verifyPayment({
      amountToman: 1000,
      authority: 'mock-never-paid',
    });
    expect(result.ok).toBe(false);
  });

  it('verify succeeds once the ledger is marked paid, and is idempotent', async () => {
    const authority = 'mock-paid-1';
    mockLedger.markPaid(authority, 340_000);

    const first = await mockDriver.verifyPayment({
      amountToman: 340_000,
      authority,
    });
    expect(first).toMatchObject({ ok: true, alreadyVerified: false });
    if (first.ok) expect(first.refId).toContain(authority);

    // Second verify of the same authority reports already-verified (code 101).
    const second = await mockDriver.verifyPayment({
      amountToman: 340_000,
      authority,
    });
    expect(second).toMatchObject({ ok: true, alreadyVerified: true });
  });

  it('verify rejects an amount that does not match the ledger', async () => {
    const authority = 'mock-mismatch';
    mockLedger.markPaid(authority, 340_000);

    const result = await mockDriver.verifyPayment({
      amountToman: 999, // not what was paid
      authority,
    });
    expect(result.ok).toBe(false);
  });
});

describe('provider selection', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults to mock when the var is unset', () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_PROVIDER', '');
    expect(getZarinpalProvider()).toBe('mock');
    expect(getZarinpalClient()).toBe(mockDriver);
  });

  it('selects the named provider', () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_PROVIDER', 'zarinpal');
    expect(getZarinpalProvider()).toBe('zarinpal');
  });

  it('throws on an unrecognized provider rather than silently mocking', () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_PROVIDER', 'stripe');
    expect(() => getZarinpalProvider()).toThrow(/no driver/);
  });

  it('does not resolve an inherited object member as a provider', () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_PROVIDER', 'toString');
    expect(() => getZarinpalProvider()).toThrow(/no driver/);
  });
});
