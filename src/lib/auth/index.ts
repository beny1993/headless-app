import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import { db } from '@/db';
import {
  accounts,
  ROLES,
  sessions,
  users,
  verificationTokens,
} from '@/db/schema/auth';
import { getAppBaseUrl, getEnvVariable, VARS } from '@/lib/utils/env';
import { handleOtpRequest } from './hooks';

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
    expiresIn: 60 * 60 * 6,
  },
  user: {
    additionalFields: {
      // Mirrors the `role` column in src/db/schema/auth.ts so it's typed on
      // `session.user`. `input: false` keeps clients from setting it, and the
      // default must stay the least-privileged role.
      role: {
        type: 'string',
        required: false,
        defaultValue: ROLES.CUSTOMER,
        input: false,
      },
    },
  },
  plugins: [
    emailOTP({
      sendVerificationOTP: handleOtpRequest,
      expiresIn: 3 * 60,
      // Better Auth's default is `'plain'` — the live sign-in code sits in
      // `verification.value` in clear text, so any read of that table (a
      // backup, drizzle-studio, a future SQL bug) hands over a working admin
      // sign-in. Hashing only affects storage: `handleOtpRequest` still gets
      // the plaintext code for the email and the magic link.
      storeOTP: 'hashed',
      // Admin panel is invite-only: an OTP never creates a user. Provision the
      // first admin with `pnpm create-admin <email>`.
      disableSignUp: true,
    }),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verificationTokens,
    },
  }),
});

export const isAuthenticatedUser = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return session;
};
