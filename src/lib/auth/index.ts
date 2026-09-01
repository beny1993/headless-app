import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { phoneNumber } from 'better-auth/plugins';
import { db } from '@/db';
import {
  accounts,
  rateLimits,
  ROLES,
  sessions,
  users,
  verificationTokens,
} from '@/db/schema/auth';
import { sendOtpSms } from '@/lib/sms';
import { getAppBaseUrl, getEnvVariable, VARS } from '@/lib/utils/env';
import { assertOtpSendAllowed, recordOtpSend } from './otp-guard';
import {
  INVALID_PHONE_MESSAGE,
  isCanonicalIranPhone,
  tempEmailForPhone,
  toLocalIranPhone,
} from './phone';

const SEND_OTP_PATH = '/phone-number/send-otp';
const VERIFY_PATH = '/phone-number/verify';

/**
 * Endpoints the phone-number plugin ships that this project must not expose.
 *
 * Customers have no passwords — that is the story's first acceptance criterion —
 * but the plugin registers three password endpoints regardless.
 * `/phone-number/reset-password` is the sharp one: it *creates* a credential
 * account with a password of the caller's choosing, which would then make
 * `/sign-in/phone-number` a working password login. It is not reachable today
 * (no `sendPasswordResetOTP` is configured, so the reset code is generated and
 * never delivered), but "unreachable because of a callback we happen not to
 * have set" is not a security boundary. A 404 is.
 */
const PASSWORD_PATHS = [
  '/sign-in/phone-number',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
];

export const auth = betterAuth({
  secret: getEnvVariable(VARS.APP_CONFIG_AUTH_SECRET, true),
  baseURL: getAppBaseUrl(),
  emailAndPassword: {
    enabled: false,
  },
  advanced: {
    cookiePrefix: 'token',
  },
  session: {
    // Thirty days. The back office's old six hours was an email-OTP setting;
    // now that every sign-in — customer *and* admin — costs a text message,
    // a short session bills the shop for the shopper's own impatience.
    expiresIn: 60 * 60 * 24 * 30,
  },
  user: {
    additionalFields: {
      // Mirrors the `role` column in src/db/schema/auth.ts so it's typed on
      // `session.user`. `input: false` keeps clients from setting it, and the
      // default must stay the least-privileged role.
      //
      // Both matter more than they did: `signUpOnVerification` creates users
      // from an unauthenticated endpoint, and `/phone-number/verify` accepts
      // arbitrary extra body fields (its schema ends in `.and(z.record(...))`),
      // which are handed to `parseUserInput` on the create path. `input: false`
      // is what drops a `"role": "admin"` posted alongside the code.
      role: {
        type: 'string',
        required: false,
        defaultValue: ROLES.CUSTOMER,
        input: false,
      },
    },
  },
  hooks: {
    /**
     * Runs before the endpoint handler, which is the only placement that
     * works for either check below.
     *
     * The throttle in particular cannot live in `sendOTP`: by then the
     * endpoint has already written a fresh verification row, and the verify
     * lookup takes the newest row for a number. A refusal there would stop the
     * SMS and still invalidate the code the shopper is holding — a stranger
     * who knows someone's number could keep them permanently signed out.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SEND_OTP_PATH && ctx.path !== VERIFY_PATH) return;

      const phone = (ctx.body as { phoneNumber?: unknown } | undefined)
        ?.phoneNumber;
      if (!isCanonicalIranPhone(phone)) {
        throw new APIError('BAD_REQUEST', {
          message: INVALID_PHONE_MESSAGE,
          code: 'INVALID_PHONE_NUMBER',
        });
      }

      if (ctx.path === SEND_OTP_PATH) await assertOtpSendAllowed(phone);
    }),
  },
  rateLimit: {
    // On by default only in production. Turned on everywhere so the limits are
    // the same thing developers and QA meet as customers do.
    enabled: true,
    // Not memory: that store is per process, so it empties on every PaaS
    // redeploy and hands an attacker a fresh budget per instance behind a load
    // balancer (carried over from the scaffold's security review).
    storage: 'database',
    // Keyed by IP — Better Auth has no per-identifier limiting, which is why
    // `otp_send_log` exists. These bound the noise; the phone throttle bounds
    // the bill. Both are needed: neither covers the other's attacker.
    customRules: {
      [SEND_OTP_PATH]: { window: 60, max: 3 },
      [VERIFY_PATH]: { window: 60, max: 10 },
    },
  },
  disabledPaths: PASSWORD_PATHS,
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        // The throttle already passed in `hooks.before`. Record first: a send
        // that is not counted is a hole in the budget, and a text message that
        // goes out uncounted is worse than one that is counted and then fails.
        await recordOtpSend(phone);
        await sendOtpSms(phone, code);
      },
      // Two minutes. Long enough for a slow SMS route, short enough that the
      // window in which a code sits in the database is small — see the security
      // note on storage below.
      expiresIn: 120,
      otpLength: 6,
      // Three wrong codes and the plugin deletes the code entirely: the fourth
      // attempt gets a 403 against a code that no longer exists.
      allowedAttempts: 3,
      // Canonical form only, never normalize-on-arrival. See ./phone.ts.
      phoneNumberValidator: isCanonicalIranPhone,
      // First verified code creates the account. `role` is not settable here
      // (`input: false` above), so every account born this way is a customer.
      signUpOnVerification: {
        getTempEmail: tempEmailForPhone,
        getTempName: toLocalIranPhone,
      },
    }),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verificationTokens,
      // Without this the adapter has no model for `storage: 'database'` and
      // the rate limiter quietly writes nowhere.
      rateLimit: rateLimits,
    },
  }),
});

export const isAuthenticatedUser = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return session;
};
