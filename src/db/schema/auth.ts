// Better Auth core tables (canonical schema for the drizzle adapter) plus a
// `role` column on users. Extend per project — then run `pnpm migrate` and
// mirror any new user fields in `user.additionalFields` in src/lib/auth/index.ts.
//
// Every timestamp is `timestamptz` (`{ withTimezone: true }`) — the repo stores
// instants in UTC and renders Jalali at the edge. A bare `timestamp()` column
// drops the offset and is a bug; audit columns come from `./columns`.
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '@/db/schema/columns';

/** The `role` column's domain. Never compare against bare strings. */
export const ROLES = {
  ADMIN: 'admin',
  CUSTOMER: 'customer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  // Customer identity. `unique` is the constraint the whole auth story rests
  // on: `src/lib/auth/phone.ts` reduces every way of writing a number to one
  // canonical `+989xxxxxxxxx`, and this index then guarantees one human gets
  // one account. Nullable because a row can exist before a number is attached.
  phoneNumber: text('phone_number').unique(),
  // Better Auth sets this itself, only after a code has actually been verified.
  phoneNumberVerified: boolean('phone_number_verified')
    .default(false)
    .notNull(),
  // Customers are the overwhelming majority and every self-service sign-up
  // path lands here — admin is granted deliberately (`pnpm create-admin`),
  // never by default. With `signUpOnVerification` this default is now on a
  // public endpoint: anyone who can receive an SMS reaches this line.
  role: text('role').default(ROLES.CUSTOMER).notNull(),
  createdAt,
  updatedAt,
});

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt,
  updatedAt,
});

export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt,
  updatedAt,
});

export const verificationTokens = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
});

/**
 * One row per OTP dispatched, so the send endpoint can be throttled **per phone
 * number**.
 *
 * Better Auth's own limiter is keyed by IP only, which is the wrong axis for
 * the abuse that costs money here: one attacker rotating through IPs can bill
 * the SMS account for thousands of messages to a single victim's handset, and
 * every extra code also invalidates the one that victim is holding. Kept
 * deliberately dumb — a phone and an instant. There is no user id because the
 * first code a person ever receives arrives before their account exists.
 *
 * Rows are pruned on write (`OtpSendLogDao.prune`); nothing older than the
 * longest throttle window is of any interest.
 */
export const otpSendLog = pgTable(
  'otp_send_log',
  {
    id: text('id').primaryKey(),
    /** Canonical `+989xxxxxxxxx`, as `normalizeIranPhone` produces it. */
    phone: text('phone').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('otp_send_log_phone_sent_at_idx').on(table.phone, table.sentAt),
  ],
);

/**
 * Better Auth's rate-limit buckets, in Postgres rather than in memory.
 *
 * The scaffold's carry-item: the default memory store is per-process, so on a
 * PaaS it resets on every redeploy and, behind more than one instance, gives an
 * attacker one full budget per instance. Column names must stay as the adapter
 * spells its fields (`key`, `count`, `lastRequest`): on a mismatch the drizzle
 * adapter throws — `The field "key" does not exist in the schema for the model
 * "rateLimit"` on the read the limiter does first — from `onRequest`, which
 * fails every auth endpoint rather than quietly disabling the limiter.
 */
export const rateLimits = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  // Epoch milliseconds. `integer` overflows three weeks into 1970.
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OtpSendLogRow = typeof otpSendLog.$inferSelect;
