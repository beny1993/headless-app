// The real Zarinpal v4 HTTP driver, exercised against a stubbed `fetch`. There is
// no test merchant account, so this is the only place the driver is proven — it
// is never called live. It pins the v4 contract from the design note: IRT
// currency on request, the StartPay redirect, and the 100/101/error verify map.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZarinpalDriver, ZARINPAL_CURRENCY } from '@/lib/zarinpal/client';

const MERCHANT = '00000000-0000-0000-0000-000000000001';

/** Stubs one fetch response and captures the request for assertions. */
const stubFetch = (json: unknown) => {
  const spy = vi.fn(async () => ({ json: async () => json }) as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
};

const bodyOf = (spy: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((spy.mock.calls[call][1] as RequestInit).body as string);

const urlOf = (spy: ReturnType<typeof vi.fn>, call = 0) =>
  spy.mock.calls[call][0] as string;

describe('real Zarinpal driver', () => {
  beforeEach(() => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_MERCHANT_ID', MERCHANT);
    vi.stubEnv('APP_CONFIG_ZARINPAL_SANDBOX', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws at construction when the merchant id is missing', () => {
    vi.stubEnv('APP_CONFIG_ZARINPAL_MERCHANT_ID', '');
    expect(() => createZarinpalDriver()).toThrow();
  });

  describe('requestPayment', () => {
    it('posts amount in Toman with currency IRT and returns the StartPay URL', async () => {
      const spy = stubFetch({
        data: { code: 100, authority: 'A00000000000000000000000000000012345' },
        errors: [],
      });

      const result = await createZarinpalDriver().requestPayment({
        amountToman: 340_000,
        callbackUrl: 'https://smokey.example/api/payments/zarinpal/callback',
        description: 'سفارش',
        orderId: 'order-1',
        mobile: '+989120000000',
      });

      expect(urlOf(spy)).toBe(
        'https://payment.zarinpal.com/pg/v4/payment/request.json',
      );
      const body = bodyOf(spy);
      expect(body.amount).toBe(340_000); // integer Toman, no conversion
      expect(body.currency).toBe(ZARINPAL_CURRENCY); // 'IRT'
      expect(body.merchant_id).toBe(MERCHANT);
      expect(body.metadata.order_id).toBe('order-1');
      // recipientPhone is not the canonical auth phone — never sent as mobile.
      expect(body.metadata.mobile).toBeUndefined();
      expect(result.authority).toBe('A00000000000000000000000000000012345');
      expect(result.redirectUrl).toBe(
        'https://payment.zarinpal.com/pg/StartPay/A00000000000000000000000000000012345',
      );
    });

    it('routes at the sandbox host when the sandbox flag is on', async () => {
      vi.stubEnv('APP_CONFIG_ZARINPAL_SANDBOX', 'true');
      const spy = stubFetch({
        data: { code: 100, authority: 'S000000000000000000000000000000012345' },
        errors: [],
      });

      const result = await createZarinpalDriver().requestPayment({
        amountToman: 1000,
        callbackUrl: 'https://smokey.example/cb',
        description: 'x',
        orderId: 'o',
      });

      expect(urlOf(spy)).toContain('https://sandbox.zarinpal.com');
      expect(result.redirectUrl).toContain('https://sandbox.zarinpal.com');
    });

    it('throws when the gateway returns a non-100 request code', async () => {
      stubFetch({
        data: [],
        errors: { code: -9, message: 'validation error' },
      });

      await expect(
        createZarinpalDriver().requestPayment({
          amountToman: 1000,
          callbackUrl: 'https://smokey.example/cb',
          description: 'x',
          orderId: 'o',
        }),
      ).rejects.toThrow(/-9|validation/);
    });
  });

  describe('verifyPayment', () => {
    it('sends amount + authority (no currency) and maps code 100 to ok', async () => {
      const spy = stubFetch({
        data: { code: 100, ref_id: 123456789, card_pan: '502229******5995' },
        errors: [],
      });

      const result = await createZarinpalDriver().verifyPayment({
        amountToman: 340_000,
        authority: 'A0000000000000000000000000000012345',
      });

      expect(urlOf(spy)).toBe(
        'https://payment.zarinpal.com/pg/v4/payment/verify.json',
      );
      const body = bodyOf(spy);
      expect(body.amount).toBe(340_000);
      expect(body.authority).toBe('A0000000000000000000000000000012345');
      expect(result).toEqual({
        ok: true,
        refId: '123456789', // coerced to string
        cardPan: '502229******5995',
        alreadyVerified: false,
      });
    });

    it('maps code 101 to ok with alreadyVerified — the idempotency signal', async () => {
      stubFetch({ data: { code: 101, ref_id: 123 }, errors: [] });

      const result = await createZarinpalDriver().verifyPayment({
        amountToman: 1000,
        authority: 'A',
      });

      expect(result).toMatchObject({ ok: true, alreadyVerified: true });
    });

    it('maps a failure code to ok:false with the gateway code and message', async () => {
      stubFetch({
        data: [],
        errors: { code: -51, message: 'session is not valid' },
      });

      const result = await createZarinpalDriver().verifyPayment({
        amountToman: 1000,
        authority: 'A',
      });

      expect(result).toEqual({
        ok: false,
        code: -51,
        message: 'session is not valid',
      });
    });
  });
});
