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
import { clientIpHeaders } from './client-ip';
import { assertOtpSendAllowed } from './otp-guard';
import { rememberOtp, takeOtp } from './otp-echo';
import { OTP_CODE_LENGTH } from './otp-throttle';
import {
  INVALID_PHONE_MESSAGE,
  isCanonicalIranPhone,
  tempEmailForPhone,
  toLocalIranPhone,
} from './phone';

const SEND_OTP_PATH = '/phone-number/send-otp';
const VERIFY_PATH = '/phone-number/verify';

/**
 * Endpoints Better Auth ships that this project must not expose.
 *
 * The three password paths: customers have no passwords — that is the story's
 * first acceptance criterion — but the plugin registers them regardless.
 * `/phone-number/reset-password` is the sharp one: it *creates* a credential
 * account with a password of the caller's choosing, which would then make
 * `/sign-in/phone-number` a working password login. It is not reachable today
 * (no `sendPasswordResetOTP` is configured, so the reset code is generated and
 * never delivered), but "unreachable because of a callback we happen not to
 * have set" is not a security boundary. A 404 is.
 *
 * `/update-user` is here for a different reason: it can *break* an account
 * permanently. This app derives `user.email` from the phone number
 * (`tempEmailForPhone`) and the column is `notNull unique`, so the two are one
 * identity — but only the create path maintains that. The plugin guards phone
 * edits with `ctx.body.phoneNumber !== null` (see its `hooks.before` matcher),
 * which means a body of `{"phoneNumber": null}` walks straight through: the
 * plugin's own schema marks `phoneNumberVerified` `input: false` but leaves
 * `phoneNumber` writable. The row keeps `…@phone.smokey.invalid` while losing
 * the number that derived it, and the next sign-in from that number takes the
 * sign-up path and dies on the unique email index — the number can never sign
 * in again, and `pnpm create-admin` hits the same wall. Nothing in this app
 * updates a profile through Better Auth, so the whole endpoint is a 404.
 */
const DISABLED_PATHS = [
  '/sign-in/phone-number',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
  '/update-user',
];

export const auth = betterAuth({
  secret: getEnvVariable(VARS.APP_CONFIG_AUTH_SECRET, true),
  baseURL: getAppBaseUrl(),
  emailAndPassword: {
    enabled: false,
  },
  advanced: {
    cookiePrefix: 'token',
    ipAddress: {
      // Cloudflare proxies the domain, so the true client IP arrives in
      // `CF-Connecting-IP` — Cloudflare sets it itself and overwrites any
      // client-supplied copy, so it cannot be forged *through* Cloudflare.
      //
      // Without this the rate limiter below is useless here. Better Auth's
      // default reads `x-forwarded-for` and trusts it only when it holds a
      // SINGLE address; behind Cloudflare + Traefik it holds either the
      // Cloudflare edge address (so every visitor through one Cloudflare colo
      // shares a bucket) or two hops (so `getIp` returns null and EVERY request
      // collapses into the one shared `no-trusted-ip` bucket — 3 OTP sends per
      // minute for the entire shop). Neither failure is visible in a log.
      //
      // **This is only sound while the origin refuses non-Cloudflare traffic.**
      // Reachable directly, the header is attacker-supplied and a forged value
      // per request mints a fresh bucket each time. Lock 443 to Cloudflare's
      // published ranges (or use a Tunnel). The per-phone `otp_send_log`
      // throttle bounds the SMS bill either way; this axis bounds the noise.
      //
      // `x-forwarded-for` stays as the fallback for a grey-clouded (DNS-only)
      // domain and for local/integration runs, which send it directly.
      //
      // Deliberately NO `trustedProxies`. It looks like the tidier fix, but it
      // switches the forwarded-header branch to a right-to-left chain walk that
      // treats every listed range as infrastructure — and naming the private
      // ranges a Docker Traefik sits in (10.0.0.0/8) would then swallow the
      // 10.99.x.x addresses `auth.integration.test.ts` uses as CLIENTS,
      // resolving them to null and putting the whole suite in one bucket. The
      // Cloudflare header removes the need to walk the chain at all.
      // ONE list, shared with the Hono rate limiter (src/lib/auth/client-ip.ts).
      // Two copies would let the two limiters bucket the same caller differently,
      // invisibly. `cf-connecting-ip` is in the list only when
      // APP_CONFIG_TRUST_CF_HEADER says this deploy is behind Cloudflare — see that
      // module for why trusting it unconditionally is worse than not trusting it.
      ipAddressHeaders: clientIpHeaders(),
    },
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

      const body = ctx.body as
        { phoneNumber?: unknown; updatePhoneNumber?: unknown } | undefined;

      const phone = body?.phoneNumber;
      if (!isCanonicalIranPhone(phone)) {
        throw new APIError('BAD_REQUEST', {
          message: INVALID_PHONE_MESSAGE,
          code: 'INVALID_PHONE_NUMBER',
        });
      }

      // `/phone-number/verify` doubles as an authenticated phone-change
      // endpoint when the body carries `updatePhoneNumber`. That branch moves
      // `phone_number` and leaves `email` on the *old* number's derivation,
      // breaking the one-identity invariant `tempEmailForPhone` rests on and
      // stranding the vacated number — its next owner cannot ever sign up,
      // because the unique email index still holds their address. This app has
      // no change-your-number story; the honest answer is a 400. (The endpoint
      // cannot go in `DISABLED_PATHS`: it is the login path too.)
      if (ctx.path === VERIFY_PATH && body?.updatePhoneNumber) {
        throw new APIError('BAD_REQUEST', {
          message: 'تغییر شماره موبایل ممکن نیست.',
          code: 'PHONE_NUMBER_CANNOT_BE_UPDATED',
        });
      }

      if (ctx.path === SEND_OTP_PATH) await assertOtpSendAllowed(phone);
    }),

    /**
     * Staging only: puts the code just sent into the response body, so the
     * login form can show it (see ./otp-echo.ts for why that is safe to ship
     * switched off, and only that).
     *
     * `takeOtp` answers `undefined` whenever the echo is off — which is also
     * what makes the failure case correct: after hooks still run when the
     * handler threw, and returning a body there would turn a failed send into
     * a cheerful 200.
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SEND_OTP_PATH) return;
      const phone = (ctx.body as { phoneNumber?: string } | undefined)
        ?.phoneNumber;
      const devCode = phone ? takeOtp(phone) : undefined;
      if (!devCode) return;
      return ctx.json({ message: 'code sent', devCode });
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
  disabledPaths: DISABLED_PATHS,
  plugins: [
    phoneNumber({
      // The throttle already passed *and counted this send* in `hooks.before`,
      // atomically — see `assertOtpSendAllowed`. Nothing to do here but send.
      sendOTP: async ({ phoneNumber: phone, code }) => {
        await sendOtpSms(phone, code);
        // No-op unless the staging echo is switched on. After the send, so a
        // provider that rejected never leaves a code to hand back.
        rememberOtp(phone, code);
      },
      // Two minutes. Long enough for a slow SMS route, short enough that the
      // window in which a code sits in the database is small.
      //
      // That window matters because **the code is stored in clear text**, and
      // this project cannot change that. The scaffold's `emailOTP` had
      // `storeOTP: 'hashed'`; `PhoneNumberOptions` has no equivalent — the
      // plugin writes `${code}:${attempts}` into `verification.value`
      // verbatim. The only hook that could hash it is `verifyOTP`, which
      // *replaces* the plugin's expiry check, attempt budget and atomic
      // single-use consume, i.e. re-implementing the whole security-critical
      // lifecycle to shrink a ≤120s at-rest window. Two minutes is the
      // compensating control, and it is the reason this is 120 and not the
      // plugin's default 300.
      //
      // Consequence to weigh at review: a read of `verification` (a backup,
      // drizzle-studio, a future SQL bug) yields a live sign-in code, and
      // since `pnpm create-admin` promotes a phone account, that includes
      // admins. Revisit on the next Better Auth upgrade.
      expiresIn: 120,
      otpLength: OTP_CODE_LENGTH,
      // Three wrong guesses, then the fourth request is refused.
      //
      // The plugin counts in the stored value (`${code}:${attempts}`): a wrong
      // guess consumes the row and writes it back with the counter raised, so
      // after three the code is still there as `${code}:3`. It is the *fourth*
      // request that peeks the counter, deletes the row and answers 403 — not
      // the third. The distinction is load-bearing: were the row already gone,
      // the fourth would find nothing and answer 400, and the login form's
      // `status === 403 → «تعداد تلاش‌ها زیاد شد»` branch would be dead code.
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
      // Required for `storage: 'database'`. Without it the drizzle adapter
      // throws `The model "rateLimit" was not found in the schema object` on
      // the first rate-limited request — loudly, not silently, since the
      // limiter runs in `onRequest` ahead of every auth endpoint.
      rateLimit: rateLimits,
    },
  }),
});

export const isAuthenticatedUser = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return session;
};
