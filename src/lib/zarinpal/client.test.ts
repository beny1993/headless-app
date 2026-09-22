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

describe('the mock gateway in a production build', () => {
  // `STATIC_INLINED_VARS` snapshots NODE_ENV at import time and the refusal
  // logs once per process, so every case stubs the environment first and then
  // re-imports the module fresh (the pattern in `env.test.ts`). Both Zarinpal
  // variables are stubbed explicitly in every case: vitest loads the developer's
  // `.env`, and an inherited value would decide the test instead of the case.
  const load = async (env: Record<string, string>) => {
    Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));
    vi.resetModules();
    return import('@/lib/zarinpal/client');
  };

  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('refuses to hand out the mock driver, naming the escape variable', async () => {
    // The failure this prevents is silent success: a shopper clicks «پرداخت
    // موفق» on the mock gateway and the order settles `paid` for zero Toman.
    const { getZarinpalClient } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
    });

    expect(() => getZarinpalClient()).toThrow(/APP_CONFIG_ZARINPAL_ALLOW_MOCK/);
  });

  it('names the provider variable too, so the operator knows which one to set', async () => {
    const { assertMockGatewayAllowed } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
    });

    expect(() => assertMockGatewayAllowed()).toThrow(
      /APP_CONFIG_ZARINPAL_PROVIDER/,
    );
  });

  it('writes the refusal to the log once, however often it is probed', async () => {
    // `/api/ready` is probed on a fixed interval; the variable name belongs in
    // the log, not once per tick.
    const { assertMockGatewayAllowed } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
    });

    expect(() => assertMockGatewayAllowed()).toThrow();
    expect(() => assertMockGatewayAllowed()).toThrow();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(
      'APP_CONFIG_ZARINPAL_ALLOW_MOCK',
    );
  });

  it('hands out the mock driver, still shouting once, when the escape is set', async () => {
    // A staging deploy is a production build on the mock gateway; the warning
    // is what keeps it from being mistaken for the real thing.
    const { getZarinpalClient, mockDriver: driver } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: 'true',
    });

    expect(getZarinpalClient()).toBe(driver);
    expect(getZarinpalClient()).toBe(driver);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats anything but `true` as no escape at all', async () => {
    const { getZarinpalClient } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: 'yes',
    });

    expect(() => getZarinpalClient()).toThrow(/APP_CONFIG_ZARINPAL_ALLOW_MOCK/);
  });

  it('leaves development alone — the mock is the point there', async () => {
    const { getZarinpalClient, mockDriver: driver } = await load({
      NODE_ENV: 'development',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
    });

    expect(getZarinpalClient()).toBe(driver);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a production build on the real gateway untouched', async () => {
    const { assertMockGatewayAllowed, getZarinpalProvider: provider } =
      await load({
        NODE_ENV: 'production',
        APP_CONFIG_ZARINPAL_PROVIDER: 'zarinpal',
        APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
      });

    expect(() => assertMockGatewayAllowed()).not.toThrow();
    expect(provider()).toBe('zarinpal');
  });
});

describe('readiness vs the money path, with online payment switched off', () => {
  // Same harness as above: NODE_ENV is snapshotted at import, so each case
  // stubs first and re-imports. Every Zarinpal variable is stubbed explicitly —
  // an inherited `.env` value would decide the case instead of the case.
  const load = async (env: Record<string, string>) => {
    Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));
    vi.resetModules();
    return import('@/lib/zarinpal/client');
  };

  const PROD_ON_MOCK = {
    NODE_ENV: 'production',
    APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
    APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('serves traffic: a shop that cannot take an online payment cannot settle a zero-Toman one', async () => {
    // The case that rolled back a real production deploy on 2026-09-22: a
    // card-to-card-only shop, refused readiness over a gateway it never calls.
    const { assertReadyToServe } = await load({
      ...PROD_ON_MOCK,
      APP_CONFIG_ZARINPAL_ENABLED: 'false',
    });

    expect(() => assertReadyToServe()).not.toThrow();
  });

  it('treats the switch as off when it is unset, as every other reader does', async () => {
    const { assertReadyToServe } = await load({
      ...PROD_ON_MOCK,
      APP_CONFIG_ZARINPAL_ENABLED: '',
    });

    expect(() => assertReadyToServe()).not.toThrow();
  });

  it('refuses again the moment online payment is switched on', async () => {
    // The deploy where the refusal is worth the outage.
    const { assertReadyToServe } = await load({
      ...PROD_ON_MOCK,
      APP_CONFIG_ZARINPAL_ENABLED: 'true',
    });

    expect(() => assertReadyToServe()).toThrow(
      /APP_CONFIG_ZARINPAL_ALLOW_MOCK/,
    );
  });

  it('still lets the deliberate escape through with the switch on', async () => {
    const { assertReadyToServe } = await load({
      NODE_ENV: 'production',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: 'true',
      APP_CONFIG_ZARINPAL_ENABLED: 'true',
    });

    expect(() => assertReadyToServe()).not.toThrow();
  });

  it('is irrelevant on a real provider, switch on or off', async () => {
    for (const enabled of ['true', 'false']) {
      const { assertReadyToServe } = await load({
        NODE_ENV: 'production',
        APP_CONFIG_ZARINPAL_PROVIDER: 'zarinpal',
        APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
        APP_CONFIG_ZARINPAL_ENABLED: enabled,
      });

      expect(() => assertReadyToServe()).not.toThrow();
    }
  });

  it('does not relax outside production either — development never refused', async () => {
    const { assertReadyToServe } = await load({
      NODE_ENV: 'development',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      APP_CONFIG_ZARINPAL_ALLOW_MOCK: '',
      APP_CONFIG_ZARINPAL_ENABLED: 'true',
    });

    expect(() => assertReadyToServe()).not.toThrow();
  });

  it('THE MONEY PATH DOES NOT RELAX: the driver still refuses with the switch off', async () => {
    // The whole safety argument for the line above. `APP_CONFIG_ZARINPAL_ENABLED`
    // is read by the checkout page to hide the option, not by the API to refuse
    // it — so the gateway is still reachable with the switch off, and it must
    // still fail closed there. If this ever passes, the relaxation has leaked
    // from "may this container serve" into "may this settle money".
    const { getZarinpalClient, assertMockGatewayAllowed } = await load({
      ...PROD_ON_MOCK,
      APP_CONFIG_ZARINPAL_ENABLED: 'false',
    });

    expect(() => getZarinpalClient()).toThrow(/APP_CONFIG_ZARINPAL_ALLOW_MOCK/);
    expect(() => assertMockGatewayAllowed()).toThrow();
  });
});
