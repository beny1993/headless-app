// The SMS seam. One function type, two drivers, chosen by env.
//
// SMS.ir is the picked provider (Benyamin, 2026-09-12). The console driver stays
// the *shipped* default: the site must work end to end — browse, log in, check
// out — on local and test deployments with no provider account. Switching is a
// provider-env change and nothing else; no caller above this seam sees it.
//
// The seam carries the **code**, not a rendered message, because that is what
// SMS.ir's verify service takes: a template id plus a named parameter, never
// free text. A `(to, message)` seam could only have been served by the bulk
// endpoint, which needs a dedicated line and is not where OTP is routed.
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { getEnvVariable, isDevelopmentServer, VARS } from '@/lib/utils/env';

/** Everything a provider has to do: get one sign-in code to one number. */
export type OtpSender = (to: string, code: string) => Promise<void>;

/** Providers with a driver behind them. */
export const SMS_PROVIDERS = ['console', 'smsir'] as const;

export type SmsProvider = (typeof SMS_PROVIDERS)[number];

const DEFAULT_PROVIDER: SmsProvider = 'console';

/**
 * The sign-in SMS, in Persian.
 *
 * The code stays in ASCII digits: it is read off a notification and typed back
 * into six boxes, and Persian glyphs there would make the shopper transliterate
 * their own login code. No link — a sign-in code that travels with a URL is the
 * shape every SMS phishing campaign imitates.
 *
 * Used by the console driver. The SMS.ir wording lives in the panel template
 * instead, which is the provider's rule, not ours.
 */
export function otpMessage(code: string): string {
  return `کد ورود شما به اسموکی: ${code}`;
}

/**
 * Writes the message to the server log instead of sending it.
 *
 * This is what makes local development and test deployments work: the OTP is
 * retrievable from `docker logs` / the `next dev` console, so QA and a browser
 * walkthrough need no SMS account. It also means **every OTP is in the server
 * log** — fine for a mock deployment, which is what this is, and the reason
 * `warnIfMocked` shouts when it is running outside development.
 */
export const consoleSmsDriver: OtpSender = async (to, code) => {
  console.log(`[sms:console] to ${to} :: ${otpMessage(code)}`);
};

// ── The real SMS.ir driver ───────────────────────────────────────────────────
// Verified live against the sandbox key on 2026-09-12: success is HTTP 200 with
// `{"status":1,...}`; an invalid key is HTTP 401 `status 10`, an unknown
// template HTTP 400 `status 113`. Both HTTP status and body status therefore
// carry the answer, and the body is JSON either way.

const SMSIR_VERIFY_URL = 'https://api.sms.ir/v1/send/verify';

/**
 * The parameter the panel template substitutes. The template body must contain
 * `#CODE#`; the sandbox's stock template 123456 already does.
 */
const CODE_PARAMETER = 'CODE';

/**
 * A login must not hang on a wedged provider. Better a visible failure the
 * shopper can retry than a request holding a server slot until the platform
 * kills it.
 */
const SEND_TIMEOUT_MS = 10_000;

/** The response is an external input boundary, so it crosses zod. */
const smsIrResponseSchema = z.object({
  status: z.number(),
  message: z.string(),
});

/** SMS.ir's "delivered to the gateway" code. Anything else is a failure. */
const SMSIR_SUCCESS_STATUS = 1;

/**
 * The real driver. Constructed only when the provider selects it, so its env
 * reads never fire under the console default. Missing or malformed credentials
 * throw at construction — the loud failure, not a login that reports success
 * while dispatching nothing.
 */
export const createSmsIrDriver = (): OtpSender => {
  const apiKey = getEnvVariable(VARS.APP_CONFIG_SMSIR_API_KEY, true).trim();
  if (!apiKey) {
    throw new Error(
      `Environment variable ${VARS.APP_CONFIG_SMSIR_API_KEY} is required and not set`,
    );
  }

  // SMS.ir wants a number here, and `Number('')` is 0 rather than an error — so
  // the blank left in a `.env` has to be caught explicitly. The id is not a
  // secret (it names a template in the panel), so it may appear in the message.
  const rawTemplateId = getEnvVariable(
    VARS.APP_CONFIG_SMSIR_TEMPLATE_ID,
    true,
  ).trim();
  const templateId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(rawTemplateId);
  if (!templateId.success) {
    throw new Error(
      `${VARS.APP_CONFIG_SMSIR_TEMPLATE_ID}="${rawTemplateId}" is not a template id ` +
        `(expected the positive integer shown on the SMS.ir panel template).`,
    );
  }

  return async (to, code) => {
    const response = await fetch(SMSIR_VERIFY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      // SMS.ir reads the national `09…` form, which is also what a shopper
      // recognizes in a delivery report; storage stays canonical `+989…`.
      body: JSON.stringify({
        mobile: toLocalIranPhone(to),
        templateId: templateId.data,
        parameters: [{ name: CODE_PARAMETER, value: code }],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    // No phone number, no code and no API key in anything thrown from here: a
    // send failure is reported to Sentry, and an OTP in a breadcrumb is the
    // leak `src/lib/sentry.ts` exists to prevent.
    const body = await response.json().catch(() => null);
    const parsed = smsIrResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `sms.ir returned an unrecognized response (HTTP ${response.status}).`,
      );
    }
    if (parsed.data.status !== SMSIR_SUCCESS_STATUS) {
      throw new Error(
        `sms.ir refused the send (HTTP ${response.status}, status ` +
          `${parsed.data.status}): ${parsed.data.message}`,
      );
    }
  };
};

// Factory functions, not constructed drivers, so the console default never
// touches SMS.ir config. `console` returns the same const every time — identity
// is what the tests pin.
const DRIVERS: Record<SmsProvider, () => OtpSender> = {
  console: () => consoleSmsDriver,
  smsir: () => createSmsIrDriver(),
};

let mockWarningLogged = false;

const warnIfMocked = () => {
  if (isDevelopmentServer() || mockWarningLogged) return;
  mockWarningLogged = true;
  const message =
    '[sms] APP_CONFIG_SMS_PROVIDER is "console": one-time codes are being ' +
    'written to the server log, not sent. Intended for mock deployments — ' +
    'set APP_CONFIG_SMS_PROVIDER=smsir before taking real customers.';
  console.warn(message);
  // The message is a fixed string with no code and no phone number in it.
  Sentry.captureMessage(message, 'warning');
};

/**
 * What the environment names as the provider, defaulted and trimmed. Not
 * checked against `DRIVERS` — `getSmsSender` does that; this is also what
 * `src/lib/auth/otp-echo.ts` reads to answer "is anything real being sent?".
 */
export function getConfiguredSmsProvider(): SmsProvider {
  const configured = getEnvVariable(
    VARS.APP_CONFIG_SMS_PROVIDER,
    false,
    DEFAULT_PROVIDER,
  );
  // `||` not `??`: an empty value (`APP_CONFIG_SMS_PROVIDER=` left in a `.env`)
  // is an unset one, and `??` would hand `''` through as a provider name.
  return (configured.trim() || DEFAULT_PROVIDER) as SmsProvider;
}

/**
 * The configured driver.
 *
 * An unrecognized value throws rather than falling back to the console driver.
 * The failure this prevents is the quiet one: the environment names a provider
 * no adapter has been written for, and every login reports success while
 * dispatching nothing.
 */
export function getSmsSender(): OtpSender {
  const provider = getConfiguredSmsProvider();

  // `Object.hasOwn`, not a truthiness check on the lookup: `DRIVERS` is an
  // object literal, so `constructor`/`toString`/`valueOf` would otherwise
  // resolve to inherited functions, pass as drivers, and "send" every code
  // into the void — the exact silent failure this throw exists to prevent.
  const driver = Object.hasOwn(DRIVERS, provider) ? DRIVERS[provider] : null;
  if (!driver) {
    throw new Error(
      `${VARS.APP_CONFIG_SMS_PROVIDER}="${provider}" has no driver. ` +
        `Known providers: ${SMS_PROVIDERS.join(', ')}.`,
    );
  }
  if (provider === 'console') warnIfMocked();
  return driver();
}

/** Dispatch one sign-in code. Rejects if the driver does. */
export async function sendOtpSms(
  phoneNumber: string,
  code: string,
): Promise<void> {
  await getSmsSender()(phoneNumber, code);
}
