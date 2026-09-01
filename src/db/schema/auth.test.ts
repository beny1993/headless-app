// Shape tests for the auth tables. No database needed, so they run everywhere;
// the constraints they describe are proven against real Postgres in
// `src/db/dao/OtpSendLogDao.integration.test.ts`.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { otpSendLog, rateLimits, ROLES, users } from '@/db/schema/auth';

describe('user phone columns', () => {
  it('stores the phone number under a unique constraint', () => {
    // One human, one account. The canonical form in `src/lib/auth/phone.ts` is
    // what makes this constraint mean anything — without it `09121234567` and
    // `+989121234567` are two rows the database is happy to keep.
    expect(users.phoneNumber.isUnique).toBe(true);
  });

  it('leaves the phone number nullable — admins seeded by email predate it', () => {
    expect(users.phoneNumber.notNull).toBe(false);
  });

  it('defaults phone_number_verified to false', () => {
    // Better Auth flips this itself on a successful verify. A default of true
    // would hand every inserted row a verified number it never proved.
    expect(users.phoneNumberVerified.default).toBe(false);
    expect(users.phoneNumberVerified.notNull).toBe(true);
  });

  it('still defaults role to customer, never admin', () => {
    // Pinned again here because `signUpOnVerification` now creates users on a
    // public endpoint: this default is the only thing between a stranger with a
    // phone and the admin panel.
    expect(users.role.default).toBe(ROLES.CUSTOMER);
    expect(users.role.default).not.toBe(ROLES.ADMIN);
  });
});

describe('otp_send_log', () => {
  it('records the phone and the send time', () => {
    const columns = Object.keys(getTableColumns(otpSendLog));
    expect(columns).toEqual(expect.arrayContaining(['phone', 'sentAt']));
  });

  it('keeps sent_at as timestamptz', () => {
    // The whole table is a time comparison. A bare `timestamp` would drop the
    // offset and make the 90-second cooldown depend on where the server runs.
    expect(otpSendLog.sentAt.getSQLType()).toBe('timestamp with time zone');
  });

  it('indexes the lookup the throttle actually does', () => {
    // Every send-otp request scans this table by phone within a time window.
    // Unindexed, the login path degrades with the log's size.
    const { indexes } = getTableConfig(otpSendLog);
    const columnNames = indexes.flatMap((index) =>
      index.config.columns.map((column) =>
        'name' in column ? column.name : '',
      ),
    );
    expect(columnNames).toContain('phone');
  });

  it('does not reference the user table', () => {
    // Codes are sent to numbers that have no account yet — that is the sign-up
    // path. A foreign key here would reject exactly those rows.
    expect(getTableConfig(otpSendLog).foreignKeys).toHaveLength(0);
  });
});

describe('rate_limit', () => {
  it('carries the three columns Better Auth writes', () => {
    // Names must match the adapter's field names (`key`, `count`,
    // `lastRequest`). On a mismatch the drizzle adapter throws from
    // `onRequest` — loudly, failing every auth endpoint — which is why this
    // assertion is about keeping the build honest, not about a silent failure.
    const columns = Object.keys(getTableColumns(rateLimits));
    expect(columns).toEqual(
      expect.arrayContaining(['key', 'count', 'lastRequest']),
    );
  });

  it('keeps last_request as a bigint — it holds epoch milliseconds', () => {
    // `Date.now()` passes 2^31 milliseconds in 1970 + 24 days; an `integer`
    // column here overflows on every write.
    expect(rateLimits.lastRequest.getSQLType()).toBe('bigint');
  });

  it('makes the key unique so one bucket cannot fork into two', () => {
    expect(rateLimits.key.isUnique).toBe(true);
  });
});

describe('every auth timestamp', () => {
  it('is stored with a timezone', () => {
    const timestamps = [users, otpSendLog]
      .flatMap((table) => Object.values(getTableColumns(table)))
      .filter((column) => column.columnType === 'PgTimestamp');

    expect(timestamps).not.toHaveLength(0);
    for (const column of timestamps) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: timestamp with time zone`,
      );
    }
  });
});
