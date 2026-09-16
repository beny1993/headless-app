// The SMS seam. One function type, two drivers, chosen by env.
//
// SMS.ir is the picked provider (Benyamin, 2026-09-12). The console driver stays
// the *shipped* default: the site must work end to end — browse, log in, check
// out — on local and test deployments with no provider account. Switching is a
// provider-env change and nothing else; no caller above this seam sees it.
//
// The seam carries a **template plus named parameters**, not a rendered message,
// because that is what SMS.ir's verify service takes. A `(to, message)` seam
// could only have been served by the bulk endpoint, which needs a dedicated
// line. Each template has its own panel id behind its own env var, so order data
// is never stuffed into the `#OTP#` template.
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { getEnvVariable, isDevelopmentServer, VARS } from '@/lib/utils/env';

/** The panel templates this app sends through. */
export const SMS_TEMPLATES = {
  OTP: 'otp',
  NEW_ORDER: 'new-order',
} as const;

export type SmsTemplate = (typeof SMS_TEMPLATES)[keyof typeof SMS_TEMPLATES];

/** The sign-in code, and the panel template that renders it. */
export type OtpSmsMessage = {
  template: typeof SMS_TEMPLATES.OTP;
  parameters: { OTP: string };
};

/** The new-order admin alert, already formatted for display. */
export type NewOrderSmsMessage = {
  template: typeof SMS_TEMPLATES.NEW_ORDER;
  parameters: { ORDER: string; AMOUNT: string; METHOD: string };
};

/**
 * One message as the seam carries it: which template, and the parameters that
 * template substitutes. A union rather than a loose `Record<string, string>` —
 * a parameter named for the wrong template is a delivered SMS with `#ORDER#`
 * still in it, and that is a compile error here instead.
 */
export type SmsMessage = OtpSmsMessage | NewOrderSmsMessage;

/** Everything a provider has to do: get one message to one number. */
export type SmsSender = (to: string, message: SmsMessage) => Promise<void>;

/** The sign-in code, as the seam carries it. */
export const otpSms = (code: string): OtpSmsMessage => ({
  template: SMS_TEMPLATES.OTP,
  parameters: { OTP: code },
});

/**
 * The new-order admin alert, as the seam carries it. The values arrive already
 * formatted for display (`src/logic/orders/notify-new-order.ts` builds them
 * through `src/lib/format.ts`) — this module knows nothing about orders.
 */
export const newOrderSms = (
  parameters: NewOrderSmsMessage['parameters'],
): NewOrderSmsMessage => ({ template: SMS_TEMPLATES.NEW_ORDER, parameters });

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
 * The new-order alert, in Persian — the console driver's rendering of what the
 * SMS.ir panel template says. No customer name, phone, city or address: an SMS
 * is not a secure channel, and the admin panel is one tap away.
 */
export function newOrderMessage(
  parameters: NewOrderSmsMessage['parameters'],
): string {
  return (
    `سفارش جدید در اسموکی — شماره ${parameters.ORDER}، ` +
    `مبلغ ${parameters.AMOUNT}، پرداخت: ${parameters.METHOD}`
  );
}

/** The console driver's text for any message the seam carries. */
const renderSms = (message: SmsMessage): string => {
  switch (message.template) {
    case SMS_TEMPLATES.OTP:
      return otpMessage(message.parameters.OTP);
    case SMS_TEMPLATES.NEW_ORDER:
      return newOrderMessage(message.parameters);
  }
};

/**
 * Writes the message to the server log instead of sending it.
 *
 * This is what makes local development and test deployments work: the OTP is
 * retrievable from `docker logs` / the `next dev` console, so QA and a browser
 * walkthrough need no SMS account. It also means **every OTP is in the server
 * log** — fine for a mock deployment, which is what this is, and the reason
 * `warnIfMocked` shouts when it is running outside development.
 */
export const consoleSmsDriver: SmsSender = async (to, message) => {
  console.log(`[sms:console] to ${to} :: ${renderSms(message)}`);
};

// ── The real SMS.ir driver ───────────────────────────────────────────────────
// Response shapes as observed from api.sms.ir on 2026-09-12: success is HTTP 200
// with `{"status":1,...}`; an invalid key is HTTP 401 `status 10`, an unknown
// template HTTP 400 `status 113`. Both HTTP status and body status therefore
// carry the answer, and the body is JSON either way.

const SMSIR_VERIFY_URL = 'https://api.sms.ir/v1/send/verify';

/**
 * A login must not hang on a wedged provider. Better a visible failure the
 * shopper can retry than a request holding a server slot until the platform
 * kills it. The order alert inherits the same bound, which is why its caller
 * needs no timeout of its own.
 */
const SEND_TIMEOUT_MS = 10_000;

/** Which env var holds each template's panel id. */
const TEMPLATE_ENV_VARS: Record<SmsTemplate, VARS> = {
  [SMS_TEMPLATES.OTP]: VARS.APP_CONFIG_SMSIR_TEMPLATE_ID,
  [SMS_TEMPLATES.NEW_ORDER]: VARS.APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID,
};

/**
 * The panel id for one template, validated.
 *
 * SMS.ir wants a number here, and `Number('')` is 0 rather than an error — so
 * the blank left in a `.env` has to be caught explicitly. The id is not a secret
 * (it names a template in the panel), so it may appear in the message.
 */
const resolveTemplateId = (template: SmsTemplate): number => {
  const variable = TEMPLATE_ENV_VARS[template];
  const raw = getEnvVariable(variable, true).trim();
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${variable}="${raw}" is not a template id ` +
        `(expected the positive integer shown on the SMS.ir panel template).`,
    );
  }
  return parsed.data;
};

/**
 * The one place the provider's *wire shape* lives: which endpoint, and what the
 * body looks like.
 *
 * ASSUMPTION, unanswered by SMS.ir as of 2026-09-16 (Benyamin asked): that the
 * **verify** service accepts a template whose body is not a sign-in code. If it
 * turns out verify templates are restricted to auth-like content, the order
 * alert has to go over the bulk/line-number API — a different URL and a
 * different body, contained to this function. A production gate before the
 * alert is switched on, not a merge gate.
 */
const buildSmsIrRequest = (
  to: string,
  templateId: number,
  parameters: Record<string, string>,
) => ({
  url: SMSIR_VERIFY_URL,
  // SMS.ir reads the national `09…` form, which is also what a shopper
  // recognizes in a delivery report; storage stays canonical `+989…`.
  body: {
    mobile: toLocalIranPhone(to),
    templateId,
    parameters: Object.entries(parameters).map(([name, value]) => ({
      name,
      value,
    })),
  },
});

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
 *
 * The OTP template id is validated here; **every other template's is not**, and
 * that asymmetry is deliberate. Sign-in is the path every deployment needs, so
 * its id must fail at boot. The order template is created later, by hand, on the
 * SMS.ir panel: validating it here would mean that flipping production to
 * `smsir` one day too early takes *login* down. It is resolved on the send that
 * uses it instead, where its absence fails that alert and nothing else.
 */
export const createSmsIrDriver = (): SmsSender => {
  const apiKey = getEnvVariable(VARS.APP_CONFIG_SMSIR_API_KEY, true).trim();
  if (!apiKey) {
    throw new Error(
      `Environment variable ${VARS.APP_CONFIG_SMSIR_API_KEY} is required and not set`,
    );
  }
  resolveTemplateId(SMS_TEMPLATES.OTP);

  return async (to, message) => {
    const { url, body } = buildSmsIrRequest(
      to,
      resolveTemplateId(message.template),
      message.parameters,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    // No phone number, no code and no API key in anything thrown from here: a
    // send failure is reported to Sentry, and an OTP in a breadcrumb is the
    // leak `src/lib/sentry.ts` exists to prevent.
    const parsedBody = await response.json().catch(() => null);
    const parsed = smsIrResponseSchema.safeParse(parsedBody);
    if (!parsed.success) {
      throw new Error(
        `sms.ir returned an unrecognized response (HTTP ${response.status}).`,
      );
    }
    if (parsed.data.status !== SMSIR_SUCCESS_STATUS) {
      throw new Error(
        `sms.ir refused the send (HTTP ${response.status}, status ` +
          // Untrusted, and on its way to Sentry: enough of the provider's
          // reason to act on, never a whole outage page.
          `${parsed.data.status}): ${parsed.data.message.slice(0, 200)}`,
      );
    }
  };
};

// Factory functions, not constructed drivers, so the console default never
// touches SMS.ir config. `console` returns the same const every time — identity
// is what the tests pin.
const DRIVERS: Record<SmsProvider, () => SmsSender> = {
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
export function getSmsSender(): SmsSender {
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

/** Dispatch one message through the configured driver. Rejects if it does. */
export async function sendSms(
  phoneNumber: string,
  message: SmsMessage,
): Promise<void> {
  await getSmsSender()(phoneNumber, message);
}

/** Dispatch one sign-in code. Rejects if the driver does. */
export async function sendOtpSms(
  phoneNumber: string,
  code: string,
): Promise<void> {
  await sendSms(phoneNumber, otpSms(code));
}
