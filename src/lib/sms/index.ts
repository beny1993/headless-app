// The SMS seam. One function type, one driver, chosen by env.
//
// Kavenegar and SMS.ir are still an open item (`Smokey Shop Info`), and until
// one is picked the console driver is the *shipped* default (Benyamin,
// 2026-09-01): the site must work end to end — browse, log in, check out — on
// local and test deployments with no provider account. Adding the real one is a
// new entry in `DRIVERS` and nothing else; no caller sees the difference.
import { getEnvVariable, isDevelopmentServer, VARS } from '@/lib/utils/env';

/** Everything a provider has to do. Deliberately the whole interface. */
export type SmsSender = (to: string, message: string) => Promise<void>;

/** Providers with a driver behind them. Kavenegar/SMS.ir join this list. */
export const SMS_PROVIDERS = ['console'] as const;

export type SmsProvider = (typeof SMS_PROVIDERS)[number];

const DEFAULT_PROVIDER: SmsProvider = 'console';

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
  console.log(`[sms:console] to ${to} :: ${message}`);
};

const DRIVERS: Record<SmsProvider, SmsSender> = {
  console: consoleSmsDriver,
};

let mockWarningLogged = false;

const warnIfMocked = () => {
  if (isDevelopmentServer() || mockWarningLogged) return;
  mockWarningLogged = true;
  console.warn(
    '[sms] APP_CONFIG_SMS_PROVIDER is "console": one-time codes are being ' +
      'written to the server log, not sent. Intended for mock deployments — ' +
      'set a real provider before taking real customers.',
  );
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
 * The failure this prevents is the quiet one: the environment names the
 * provider that was finally chosen, no adapter has been written yet, and every
 * login reports success while dispatching nothing.
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
  return driver;
}

/**
 * The sign-in SMS, in Persian.
 *
 * The code stays in ASCII digits: it is read off a notification and typed back
 * into six boxes, and Persian glyphs there would make the shopper transliterate
 * their own login code. No link — a sign-in code that travels with a URL is the
 * shape every SMS phishing campaign imitates.
 */
export function otpMessage(code: string): string {
  return `کد ورود شما به اسموکی: ${code}`;
}

/** Dispatch one sign-in code. Rejects if the driver does. */
export async function sendOtpSms(
  phoneNumber: string,
  code: string,
): Promise<void> {
  await getSmsSender()(phoneNumber, otpMessage(code));
}
