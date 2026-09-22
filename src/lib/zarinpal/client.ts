// The Zarinpal gateway seam — one typed interface, two drivers behind it, chosen
// by env. It mirrors the SMS seam (`src/lib/sms`): the mock is the *shipped*
// default so the whole payment flow works on local and test deployments with no
// gateway account, and turning on the real gateway is a provider-env change and
// nothing else — no consumer above this seam sees the difference.
//
// **Nothing here may import `@/db`.** The drivers speak HTTP (or an in-memory
// ledger); persistence is the caller's job in `src/logic/payments`. Keeping the
// database out also lets `client.test.ts` run on the DB-less path with 0 failures.
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { API_PATHS } from '@/lib/constant/paths';
import {
  getAppBaseUrl,
  getEnvVariable,
  isDevelopmentServer,
  isProductionServer,
  VARS,
} from '@/lib/utils/env';

/**
 * Zarinpal's amount unit. `IRT` = Toman, so the shop's internal integer-Toman
 * amounts cross the gateway boundary with ZERO numeric conversion. The docs mark
 * `currency` optional and do not document a default, so the real driver always
 * sends this explicitly — never rely on the undocumented default. Pinned by a
 * test so a stray edit to `IRR` (Rial, a 10× amount) fails the build, not a
 * customer's card.
 */
export const ZARINPAL_CURRENCY = 'IRT' as const;

/** What a payment request needs. `amountToman` is integer Toman, as stored. */
export type ZarinpalRequest = {
  amountToman: number;
  callbackUrl: string;
  description: string;
  orderId: string;
  mobile?: string;
};

/**
 * A verify outcome. `ok: true` covers Zarinpal code 100 (first verify) and 101
 * (already verified) — both mean the money moved, so both settle the order; the
 * `alreadyVerified` flag is kept only for the audit trail. `ok: false` carries
 * the gateway code and message for the failure record.
 */
export type ZarinpalVerifyResult =
  | {
      ok: true;
      refId: string;
      cardPan: string | null;
      alreadyVerified: boolean;
    }
  | { ok: false; code: number; message: string };

/**
 * Everything a driver must do. `requestPayment` returns the redirect URL as well
 * as the authority so the driver — not the caller — owns the StartPay-vs-mock
 * host difference; the endpoint that starts a payment stays driver-agnostic.
 */
export type ZarinpalClient = {
  requestPayment(
    request: ZarinpalRequest,
  ): Promise<{ authority: string; redirectUrl: string }>;
  verifyPayment(params: {
    amountToman: number;
    authority: string;
  }): Promise<ZarinpalVerifyResult>;
};

// ── The mock gateway ─────────────────────────────────────────────────────────

/**
 * The mock gateway's in-memory record of which authorities have been "paid" and
 * for how much. The mock-complete route writes it when a human clicks Pay (or
 * Abandon-after-pay) on the mock gateway page; the mock driver's `verifyPayment`
 * reads it and checks the amount. Exported so the route and the tests can drive
 * it.
 *
 * ponytail: in-memory, so it resets on server restart / HMR — fine for a mock.
 * A payment "in flight" across a restart simply reads as unpaid, which the
 * reconcile job then expires; nothing durable rests on this map.
 */
export const mockLedger = {
  paid: new Map<string, number>(),
  verified: new Set<string>(),
  /** Record a simulated successful payment of `amountToman` for `authority`. */
  markPaid(authority: string, amountToman: number): void {
    this.paid.set(authority, amountToman);
  },
  /** Drop all state — call between tests (module-level state is shared). */
  reset(): void {
    this.paid.clear();
    this.verified.clear();
  },
};

/**
 * The controllable mock. It never randomly succeeds or fails: a payment is
 * "made" only when the ledger says so (a human clicked Pay, or a test called
 * `mockLedger.markPaid`). Verify is amount-checked and idempotent — a second
 * verify of the same authority reports `alreadyVerified`, mirroring code 101.
 */
export const mockDriver: ZarinpalClient = {
  async requestPayment({ orderId }) {
    // Distinct per attempt — retries need distinct authorities for the unique
    // index — and `mock-` prefixed so it is unmistakable in logs and can never
    // collide with a real (or sandbox `S…`) authority.
    const authority = `mock-${orderId}-${crypto.randomUUID().slice(0, 8)}`;
    const redirectUrl = `${getAppBaseUrl()}${API_PATHS.PAYMENT_MOCK_GATEWAY}?authority=${encodeURIComponent(
      authority,
    )}`;
    return { authority, redirectUrl };
  },

  async verifyPayment({ amountToman, authority }) {
    const paidAmount = mockLedger.paid.get(authority);
    if (paidAmount === undefined) {
      // Not paid — a plain Fail, or an authority that never completed. Mirrors a
      // Zarinpal "not paid / cannot verify" outcome.
      return { ok: false, code: -51, message: 'transaction not paid' };
    }
    if (paidAmount !== amountToman) {
      // The real gateway verifies the amount; a mismatch is a hard failure, and
      // exercising it here proves the caller passes the stored row amount.
      return { ok: false, code: -33, message: 'amount mismatch' };
    }
    const alreadyVerified = mockLedger.verified.has(authority);
    mockLedger.verified.add(authority);
    return {
      ok: true,
      refId: `mockref-${authority}`,
      cardPan: '502229******5995',
      alreadyVerified,
    };
  },
};

// ── The real Zarinpal v4 HTTP driver ─────────────────────────────────────────
// Written to the docs verified in the design note (2026-08-29). It ships in the
// repo but stays inert until APP_CONFIG_ZARINPAL_PROVIDER=zarinpal selects it and
// a merchant id is set. There is no test account, so it is unit-tested against a
// stubbed `fetch` (see zarinpal-driver.test.ts) and never called live here.

const LIVE_HOST = 'https://payment.zarinpal.com';
const SANDBOX_HOST = 'https://sandbox.zarinpal.com';

// The gateway response is an external input boundary, so it crosses a zod schema
// (Benyamin's standing rule). `data` is an object on success and `[]` on error;
// `errors` is the reverse. Unknown keys are stripped, not rejected — the gateway
// may add fields.
const requestDataSchema = z.object({
  code: z.number(),
  authority: z.string(),
});
const verifyDataSchema = z.object({
  code: z.number(),
  ref_id: z.union([z.number(), z.string()]).optional(),
  card_pan: z.string().nullish(),
});
const errorsSchema = z.object({ code: z.number(), message: z.string() });
const envelopeSchema = z.object({ data: z.unknown(), errors: z.unknown() });

/** Reads Zarinpal's `errors` block, or a fallback when it is absent/empty. */
const readErrors = (errors: unknown): { code: number; message: string } => {
  const parsed = errorsSchema.safeParse(errors);
  return parsed.success
    ? parsed.data
    : { code: 0, message: 'unrecognized Zarinpal response' };
};

/**
 * The real driver. Constructed only when the provider selects it, so its env
 * reads (merchant id) never fire under the mock default. A missing merchant id
 * throws at construction — the loud failure, not a silent misconfigured charge.
 */
export const createZarinpalDriver = (): ZarinpalClient => {
  const merchantId = getEnvVariable(VARS.APP_CONFIG_ZARINPAL_MERCHANT_ID, true);
  const sandbox =
    getEnvVariable(VARS.APP_CONFIG_ZARINPAL_SANDBOX, false, 'false').trim() ===
    'true';
  const host = sandbox ? SANDBOX_HOST : LIVE_HOST;

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  return {
    async requestPayment({ amountToman, callbackUrl, description, orderId }) {
      const json = await post('/pg/v4/payment/request.json', {
        merchant_id: merchantId,
        amount: amountToman,
        currency: ZARINPAL_CURRENCY,
        callback_url: callbackUrl,
        description,
        // `mobile` is deliberately NOT sent: the order's recipientPhone is
        // bounded free text, not the canonical +989… auth phone, and the gateway
        // may reject a malformed one. Add it via phone normalization if wanted.
        metadata: { order_id: orderId },
      });
      const envelope = envelopeSchema.parse(json);
      const data = requestDataSchema.safeParse(envelope.data);
      if (!data.success || data.data.code !== 100) {
        const { code, message } = readErrors(envelope.errors);
        throw new Error(
          `Zarinpal payment request failed (code ${code}): ${message}`,
        );
      }
      return {
        authority: data.data.authority,
        redirectUrl: `${host}/pg/StartPay/${data.data.authority}`,
      };
    },

    async verifyPayment({ amountToman, authority }) {
      const json = await post('/pg/v4/payment/verify.json', {
        merchant_id: merchantId,
        amount: amountToman,
        authority,
      });
      const envelope = envelopeSchema.parse(json);
      const data = verifyDataSchema.safeParse(envelope.data);
      // 100 = first successful verify, 101 = already verified — both are success.
      if (data.success && (data.data.code === 100 || data.data.code === 101)) {
        return {
          ok: true,
          refId: data.data.ref_id != null ? String(data.data.ref_id) : '',
          cardPan: data.data.card_pan ?? null,
          alreadyVerified: data.data.code === 101,
        };
      }
      // Only a DEFINITIVE answer may become `ok: false`, because the caller
      // (settlePendingPayment) turns that into `markFailed`, and reconcile pass 1
      // lists only `pending` rows — a row marked `failed` is never re-verified, so
      // marking a possibly-paid attempt failed strands the money with no retry.
      // Definitive = Zarinpal spoke about THIS transaction, in a shape we know:
      //   · a structured verify `data` with a code (100/101 handled above), or
      //   · a parseable `errors` block.
      if (data.success) {
        return {
          ok: false,
          code: data.data.code,
          message: 'verify not successful',
        };
      }
      const errors = errorsSchema.safeParse(envelope.errors);
      if (errors.success) {
        return {
          ok: false,
          code: errors.data.code,
          message: errors.data.message,
        };
      }
      // Neither shape: the response is INDETERMINATE (a gateway/proxy outage body,
      // a truncated payload, or an envelope shape Zarinpal changed under us). We
      // cannot tell whether the money moved, so THROW — settlePendingPayment leaves
      // the row `pending` and the next reconcile sweep re-verifies it, rather than
      // failing it off the worklist for good. (No merchant id in the message.)
      throw new Error(
        'Zarinpal verify returned an unrecognized response; left pending for retry',
      );
    },
  };
};

// ── Provider selection ───────────────────────────────────────────────────────

/** Providers with a driver behind them. */
export const ZARINPAL_PROVIDERS = ['mock', 'zarinpal'] as const;

export type ZarinpalProvider = (typeof ZARINPAL_PROVIDERS)[number];

const DEFAULT_PROVIDER: ZarinpalProvider = 'mock';

// Factory functions, not constructed drivers: the real driver reads env only
// when actually selected, so the mock default never touches Zarinpal config.
const DRIVERS: Record<ZarinpalProvider, () => ZarinpalClient> = {
  mock: () => mockDriver,
  zarinpal: () => createZarinpalDriver(),
};

let mockRefusalLogged = false;

/**
 * Refuses the simulated gateway in a production build.
 *
 * `mock` is the shipped default, so two variables left unset — the provider and
 * nothing else — put a production container on a gateway that reports every
 * checkout as paid while charging nothing. That is silent success, the worst
 * shape a money bug has, so it fails closed instead: a production build on
 * `mock` serves nothing until `APP_CONFIG_ZARINPAL_ALLOW_MOCK=true` says the
 * simulation is deliberate (a staging deploy, which has no gateway account).
 *
 * Reached from `GET /api/ready` through {@link assertReadyToServe}, which adds
 * the one condition this function deliberately does not have — see there.
 * `getZarinpalClient` calls this one directly and unconditionally: whatever any
 * switch says, a production build must not hand out a driver that reports money
 * as taken when none was.
 *
 * Deliberately NOT in `getZarinpalProvider`: `payments.ts` gates the mock-only
 * endpoints on the provider and not on NODE_ENV, and that has to keep working.
 */
export function assertMockGatewayAllowed(): void {
  if (getZarinpalProvider() !== 'mock') return;
  if (!isProductionServer()) return;
  // `=== 'true'`, so a typo, `1`, `yes` or a blank is no escape at all.
  if (
    getEnvVariable(VARS.APP_CONFIG_ZARINPAL_ALLOW_MOCK, false, '').trim() ===
    'true'
  ) {
    return;
  }

  const message =
    `[zarinpal] ${VARS.APP_CONFIG_ZARINPAL_PROVIDER} is "mock" in a production ` +
    'build: every checkout would settle as paid for zero Toman. Set a real ' +
    'provider and merchant id, or set ' +
    `${VARS.APP_CONFIG_ZARINPAL_ALLOW_MOCK}=true if this deploy is meant to ` +
    'run on the simulated gateway.';

  // Once per process: the readiness probe runs on a fixed interval, and the
  // operator needs the variable name in the log, not on every tick. The throw
  // is what stops the traffic; this is what tells them why.
  if (!mockRefusalLogged) {
    mockRefusalLogged = true;
    console.error(message);
  }
  throw new Error(message);
}

/** Whether online payment is switched on for this deploy. */
export const isZarinpalEnabled = (): boolean =>
  getEnvVariable(VARS.APP_CONFIG_ZARINPAL_ENABLED, false, '').trim() === 'true';

/**
 * The readiness half of {@link assertMockGatewayAllowed}: may this container
 * take traffic at all?
 *
 * A container that cannot take an online payment cannot settle a zero-Toman one
 * either, so with `APP_CONFIG_ZARINPAL_ENABLED` off the mock provider says
 * nothing about whether this instance should serve. Refusing anyway takes a
 * card-to-card-only shop off the air over a gateway it never calls — which is
 * not theoretical: it rolled back a production deploy on 2026-09-22, for a
 * subsystem that was switched off.
 *
 * What does NOT relax is the money path. `getZarinpalClient` still calls
 * {@link assertMockGatewayAllowed} unconditionally, so if anything reaches the
 * gateway in a production build on `mock` it throws there — and it can be
 * reached with the switch off, because `APP_CONFIG_ZARINPAL_ENABLED` is read by
 * the checkout page to hide the option, not by the API to refuse it. The
 * shopper gets a failed request and the payment row stays `pending`; no order
 * settles. That is the fail-closed half, and it is why relaxing this one is
 * safe.
 *
 * And the moment online payment is switched on, readiness refuses again —
 * which is precisely the deploy where a refusal is worth the outage.
 */
export function assertReadyToServe(): void {
  if (!isZarinpalEnabled()) return;
  assertMockGatewayAllowed();
}

let mockWarningLogged = false;

const warnIfMocked = () => {
  if (isDevelopmentServer() || mockWarningLogged) return;
  mockWarningLogged = true;
  const message =
    '[zarinpal] APP_CONFIG_ZARINPAL_PROVIDER is "mock": payments are simulated, ' +
    'not charged. Intended for mock/test deployments — set a real provider and ' +
    'merchant id before taking real payments.';
  console.warn(message);
  Sentry.captureMessage(message, 'warning');
};

/**
 * The configured provider name, validated. An unrecognized value throws rather
 * than falling back to the mock: the quiet failure this prevents is a deploy that
 * names the real gateway, has no driver yet, and reports every checkout as paid
 * while charging nothing. Routes also use this to gate the mock-only endpoints.
 */
export function getZarinpalProvider(): ZarinpalProvider {
  // `||` not `??`: an empty value (the var left blank in a `.env`) is an unset
  // one, and `??` would hand `''` through as a provider name.
  const configured =
    getEnvVariable(
      VARS.APP_CONFIG_ZARINPAL_PROVIDER,
      false,
      DEFAULT_PROVIDER,
    ).trim() || DEFAULT_PROVIDER;

  // `Object.hasOwn`, not truthiness on the lookup: inherited members
  // (`toString`, `constructor`) would otherwise resolve to functions and pass as
  // drivers — the exact silent failure this guard exists to prevent.
  if (!Object.hasOwn(DRIVERS, configured)) {
    throw new Error(
      `${VARS.APP_CONFIG_ZARINPAL_PROVIDER}="${configured}" has no driver. ` +
        `Known providers: ${ZARINPAL_PROVIDERS.join(', ')}.`,
    );
  }
  return configured as ZarinpalProvider;
}

/**
 * The configured driver. Selecting `mock` in a production build throws unless
 * the escape is set (see {@link assertMockGatewayAllowed}); selecting it
 * anywhere outside development shouts once.
 */
export function getZarinpalClient(): ZarinpalClient {
  const provider = getZarinpalProvider();
  if (provider === 'mock') {
    assertMockGatewayAllowed();
    warnIfMocked();
  }
  return DRIVERS[provider]();
}
