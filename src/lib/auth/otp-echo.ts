// Showing the one-time code on the login page — staging and local only.
//
// The console SMS driver writes codes to the server log, which works for a
// developer holding a terminal and not for anyone testing a deployed staging
// build from a phone. This hands the code back in the `/phone-number/send-otp`
// response so the form can print it (`src/lib/auth/index.ts` attaches it,
// `login-form.tsx` renders it).
//
// It is, plainly, an authentication bypass: whoever can call send-otp for a
// number is told that number's code. Hence two independent gates, which fail
// in opposite directions:
//
//   - `APP_CONFIG_SHOW_OTP_IN_UI` must be exactly `true`. Off by default, and
//     absent from `.env.example`'s production guidance.
//   - the SMS provider must still be `console`. A production environment has a
//     real provider, so the flag leaking into it does nothing; and a
//     production environment left on `console` is already broken in the safe
//     direction (nobody receives a code) rather than the unsafe one (everybody
//     receives everybody's).
import { z } from 'zod';
import { getConfiguredSmsProvider } from '@/lib/sms';
import { getEnvVariable, VARS } from '@/lib/utils/env';

/**
 * The extra field on the send-otp response. The one shared contract: the route
 * builds the body from it and the login form parses it, so neither side can
 * drift from the other's field name.
 */
export const otpEchoResponseSchema = z.object({ devCode: z.string() });

export const isOtpEchoEnabled = () =>
  getEnvVariable(VARS.APP_CONFIG_SHOW_OTP_IN_UI, false, '') === 'true' &&
  getConfiguredSmsProvider() === 'console';

/**
 * Codes waiting to be attached to the response that generated them.
 *
 * Keyed by phone number, written by `sendOTP` and read microseconds later by
 * the `after` hook of the same request — never a store, never a fallback for
 * looking a code up later. Empty when the echo is off, because nothing writes.
 */
const pending = new Map<string, string>();

export const rememberOtp = (phoneNumber: string, code: string) => {
  if (!isOtpEchoEnabled()) return;
  pending.set(phoneNumber, code);
};

/** Reads and clears in one step, so a code is echoed once and to one caller. */
export const takeOtp = (phoneNumber: string) => {
  const code = pending.get(phoneNumber);
  pending.delete(phoneNumber);
  return code;
};
