// Needs a live database — see src/db/test-db.ts.
import { faker } from '@faker-js/faker';
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { otpSendLog } from '@/db/schema/auth';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { OtpSendLogDao } = await importWithDb(
  () => import('@/db/dao/OtpSendLogDao'),
);

describe.skipIf(!databaseReachable)('OtpSendLogDao', () => {
  const phones: string[] = [];

  /** A canonical number nobody else's test is using. */
  const phone = () => {
    const value = `+9891${faker.string.numeric(8)}`;
    phones.push(value);
    return value;
  };

  afterEach(async () => {
    if (phones.length === 0) return;
    // Test teardown, not an application path.
    await testDb.delete(otpSendLog).where(inArray(otpSendLog.phone, phones));
    phones.length = 0;
  });

  const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000);

  it('reports no sends for a number that has never asked for a code', async () => {
    expect(await OtpSendLogDao.sentAtSince(phone(), secondsAgo(3600))).toEqual(
      [],
    );
  });

  it('records a send and reads it back inside the window', async () => {
    const number = phone();

    await OtpSendLogDao.record(number);

    const sends = await OtpSendLogDao.sentAtSince(number, secondsAgo(3600));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toBeInstanceOf(Date);
  });

  it('records each send separately — the cap counts them', async () => {
    const number = phone();

    await OtpSendLogDao.record(number);
    await OtpSendLogDao.record(number);
    await OtpSendLogDao.record(number);

    expect(
      await OtpSendLogDao.sentAtSince(number, secondsAgo(3600)),
    ).toHaveLength(3);
  });

  it('never leaks one number’s sends into another’s budget', async () => {
    // The throttle is per phone. Reading a neighbour's rows would lock out a
    // stranger who merely shares an operator prefix.
    const mine = phone();
    const theirs = phone();

    await OtpSendLogDao.record(theirs);
    await OtpSendLogDao.record(theirs);

    expect(await OtpSendLogDao.sentAtSince(mine, secondsAgo(3600))).toEqual([]);
  });

  it('excludes sends older than the window it is asked for', async () => {
    const number = phone();
    await OtpSendLogDao.record(number);

    // A window that starts in the future cannot contain the row just written.
    const sends = await OtpSendLogDao.sentAtSince(
      number,
      new Date(Date.now() + 60_000),
    );

    expect(sends).toEqual([]);
  });

  it('stores the send instant in UTC, whatever the server’s zone', async () => {
    // The cooldown is a duration between two instants; a naive timestamp would
    // make its length depend on where the container runs.
    const number = phone();
    const before = Date.now();

    await OtpSendLogDao.record(number);

    const [sentAt] = await OtpSendLogDao.sentAtSince(number, secondsAgo(60));
    // Allow a second of clock granularity either side of the write.
    expect(sentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sentAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('prunes rows older than the cutoff and keeps the rest', async () => {
    const number = phone();
    await OtpSendLogDao.record(number);

    // Nothing is older than "an hour ago" yet, so this must delete nothing.
    await OtpSendLogDao.prune(secondsAgo(3600));
    expect(
      await OtpSendLogDao.sentAtSince(number, secondsAgo(3600)),
    ).toHaveLength(1);

    // A cutoff in the future covers the row just written.
    await OtpSendLogDao.prune(new Date(Date.now() + 60_000));
    expect(await OtpSendLogDao.sentAtSince(number, secondsAgo(3600))).toEqual(
      [],
    );
  });

  it('accepts a number that has no user account', async () => {
    // The first code anyone receives arrives before their account exists — a
    // foreign key on this table would reject exactly the sign-up path.
    await expect(OtpSendLogDao.record(phone())).resolves.not.toThrow();
  });
});
