// Needs a live database — see src/db/test-db.ts.
//
// The `under concurrency` suite is the main reason this file needs real
// Postgres: `decideAndRecord`'s whole job is to hold a lock across a read and
// a write, and a mocked `db` cannot disprove a race. Two tests below need it
// independently — the absent foreign key and the `timestamptz` instant are
// things only the database can be asked about.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { otpSendLog } from '@/db/schema/auth';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { evaluateOtpThrottle } from '@/lib/auth/otp-throttle';

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
  const ALLOW = () => ({ allowed: true, retryAfterSeconds: 0 });
  const DENY = () => ({ allowed: false, retryAfterSeconds: 42 });

  /** Every send logged for a number, newest-agnostic. */
  const sendsFor = async (number: string) =>
    testDb
      .select({ sentAt: otpSendLog.sentAt })
      .from(otpSendLog)
      .where(eq(otpSendLog.phone, number));

  describe('deciding and recording', () => {
    it('sees no sends for a number that has never asked for a code', async () => {
      let seen: Date[] | undefined;

      await OtpSendLogDao.decideAndRecord(phone(), secondsAgo(3600), (rows) => {
        seen = rows;
        return ALLOW();
      });

      expect(seen).toEqual([]);
    });

    it('records the send when the decision allows it', async () => {
      const number = phone();

      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), ALLOW);

      const sends = await sendsFor(number);
      expect(sends).toHaveLength(1);
      expect(sends[0]!.sentAt).toBeInstanceOf(Date);
    });

    it('writes nothing when the decision refuses', async () => {
      // A refused send costs no budget: the shopper never got a message.
      const number = phone();

      const decision = await OtpSendLogDao.decideAndRecord(
        number,
        secondsAgo(3600),
        DENY,
      );

      expect(decision.retryAfterSeconds).toBe(42);
      expect(await sendsFor(number)).toEqual([]);
    });

    it('hands the decision every send in the window, so the cap can count', async () => {
      const number = phone();
      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), ALLOW);
      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), ALLOW);

      let seen = 0;
      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), (rows) => {
        seen = rows.length;
        return ALLOW();
      });

      expect(seen).toBe(2);
    });

    it('never leaks one number’s sends into another’s budget', async () => {
      // The throttle is per phone. Reading a neighbour's rows would lock out a
      // stranger who merely shares an operator prefix.
      const mine = phone();
      const theirs = phone();
      await OtpSendLogDao.decideAndRecord(theirs, secondsAgo(3600), ALLOW);
      await OtpSendLogDao.decideAndRecord(theirs, secondsAgo(3600), ALLOW);

      let seen: Date[] | undefined;
      await OtpSendLogDao.decideAndRecord(mine, secondsAgo(3600), (rows) => {
        seen = rows;
        return ALLOW();
      });

      expect(seen).toEqual([]);
    });

    it('excludes sends older than the window it is asked for', async () => {
      const number = phone();
      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), ALLOW);

      // A window that starts in the future cannot contain the row just written.
      let seen: Date[] | undefined;
      await OtpSendLogDao.decideAndRecord(
        number,
        new Date(Date.now() + 60_000),
        (rows) => {
          seen = rows;
          return ALLOW();
        },
      );

      expect(seen).toEqual([]);
    });

    it('stores the send instant in UTC, whatever the server’s zone', async () => {
      // The cooldown is a duration between two instants; a naive timestamp
      // would make its length depend on where the container runs.
      const number = phone();
      const before = Date.now();

      await OtpSendLogDao.decideAndRecord(number, secondsAgo(60), ALLOW);

      const [row] = await sendsFor(number);
      // Allow a second of clock granularity either side of the write.
      expect(row!.sentAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row!.sentAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('accepts a number that has no user account', async () => {
      // The first code anyone receives arrives before their account exists — a
      // foreign key on this table would reject exactly the sign-up path.
      await expect(
        OtpSendLogDao.decideAndRecord(phone(), secondsAgo(3600), ALLOW),
      ).resolves.toBeDefined();
    });
  });

  describe('under concurrency', () => {
    /** The real throttle, so these pin the shipped policy and not a stand-in. */
    const realDecision = (now: Date) => (sends: Date[]) =>
      evaluateOtpThrottle(sends, now);

    it('lets exactly one of ten simultaneous sends through', async () => {
      // The defect this closes: check-then-act. Ten requests read the same
      // empty log, all pass, and the victim's handset gets ten messages
      // against a policy of one per ninety seconds. Better Auth's own limiter
      // cannot stand in for this one: it is keyed by IP, so an attacker who
      // spreads the burst over ten addresses stays inside its budget while
      // this rule is the only thing left holding.
      const number = phone();
      const now = new Date();

      const decisions = await Promise.all(
        Array.from({ length: 10 }, () =>
          OtpSendLogDao.decideAndRecord(
            number,
            secondsAgo(3600),
            realDecision(now),
          ),
        ),
      );

      expect(decisions.filter((d) => d.allowed)).toHaveLength(1);
      expect(await sendsFor(number)).toHaveLength(1);
    });

    it('makes a send wait while another holds that number’s lock', async () => {
      // The test above asserts the outcome, but its transactions are so short
      // that they can happen to serialize on their own — it passes even with
      // the lock removed, so on its own it pins nothing. This one is
      // deterministic: hold the number's lock from a second connection and
      // `decideAndRecord` must not get past its read until it is released.
      const number = phone();
      const holder = new Pool({
        connectionString: process.env.APP_CONFIG_DATABASE_URL,
      });
      const client = await holder.connect();

      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [
          number,
        ]);

        let settled = false;
        const blocked = OtpSendLogDao.decideAndRecord(
          number,
          secondsAgo(3600),
          ALLOW,
        ).then((decision) => {
          settled = true;
          return decision;
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
        expect(await sendsFor(number)).toEqual([]);

        await client.query('rollback');
        await expect(blocked).resolves.toMatchObject({ allowed: true });
      } finally {
        client.release();
        await holder.end();
      }
    });

    it('does not make a different number wait on that same lock', async () => {
      // Proves the lock is keyed on the number and not global: one shopper
      // signing in must never queue behind another's send.
      const held = phone();
      const other = phone();
      const holder = new Pool({
        connectionString: process.env.APP_CONFIG_DATABASE_URL,
      });
      const client = await holder.connect();

      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [
          held,
        ]);

        await expect(
          OtpSendLogDao.decideAndRecord(other, secondsAgo(3600), ALLOW),
        ).resolves.toMatchObject({ allowed: true });

        await client.query('rollback');
      } finally {
        client.release();
        await holder.end();
      }
    });

    it('holds the hourly cap against a simultaneous burst', async () => {
      // Pins the *policy* at the cap rather than the race: with five rows
      // already logged, every decision denies whatever the interleaving, so
      // this one would pass with the lock removed. The lock itself is pinned
      // by the lock-holder test above; this covers the cap boundary being the
      // thing that refuses, with the cooldown deliberately out of the way.
      const number = phone();
      const now = new Date();
      await testDb.insert(otpSendLog).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: crypto.randomUUID(),
          phone: number,
          sentAt: new Date(now.getTime() - (100 + i * 60) * 1000),
        })),
      );

      const decisions = await Promise.all(
        Array.from({ length: 5 }, () =>
          OtpSendLogDao.decideAndRecord(
            number,
            secondsAgo(3600),
            realDecision(now),
          ),
        ),
      );

      expect(decisions.every((d) => !d.allowed)).toBe(true);
      expect(await sendsFor(number)).toHaveLength(5);
    });

    // Deliberately no "two different numbers both succeed" test here: two
    // concurrent `decideAndRecord` calls both return `allowed` under a global
    // key and under no lock at all, so it would pin nothing. Granularity is
    // pinned by the held-lock test above, which blocks on one number and must
    // not block on another.
  });

  describe('pruning', () => {
    it('drops rows past the cutoff and keeps the ones inside it', async () => {
      // `prune` is deliberately table-wide — it takes no phone — so the cutoff
      // stays in the past. A cutoff in the future matches every row in the
      // database, including the ones `auth.integration.test.ts` seeds for its
      // throttle assertions. Nothing runs alongside this today
      // (`fileParallelism: false` in vitest.config.ts, for exactly this
      // reason), so the past cutoff is belt to that braces: it keeps the test
      // honest on its own, rather than resting on a config line one directory
      // away.
      const number = phone();
      await testDb.insert(otpSendLog).values({
        id: crypto.randomUUID(),
        phone: number,
        sentAt: secondsAgo(7200),
      });
      await OtpSendLogDao.decideAndRecord(number, secondsAgo(3600), ALLOW);

      await OtpSendLogDao.prune(secondsAgo(3600));

      const left = await sendsFor(number);
      expect(left).toHaveLength(1);
      expect(left[0]!.sentAt.getTime()).toBeGreaterThan(
        Date.now() - 3600 * 1000,
      );
    });
  });
});
