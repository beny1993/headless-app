// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { otpSendLog } from '@/db/schema/auth';

/**
 * The OTP send log — the evidence the per-phone throttle reasons over.
 *
 * The decision itself is `evaluateOtpThrottle` in `src/lib/auth/otp-throttle.ts`,
 * a pure function so its boundaries can be tested without a database. This DAO
 * owns only the part that must touch Postgres — and, critically, owns *when*
 * the decision is taken relative to the write, which is why there is no
 * "read the log" method to call separately.
 */
export class OtpSendLogDao {
  /**
   * Decide whether this number may be sent a code and, if so, log the send —
   * atomically, as one transaction that no concurrent request can interleave.
   *
   * The split version of this (read the log, decide, insert later) is a
   * check-then-act race: N simultaneous sends for one number all read the same
   * empty log, all pass, and all dispatch. Measured before this was closed, ten
   * concurrent requests produced ten text messages against a policy of one per
   * ninety seconds. Better Auth's own limiter cannot cover it — that one is
   * keyed by IP, and spreading a burst across addresses is the cheap half of
   * the attack.
   *
   * `pg_advisory_xact_lock` serializes on the number itself rather than on any
   * row, because the first code a person is ever sent has no row to lock and no
   * account behind it. The lock is transaction-scoped, so it is released on
   * commit or rollback with nothing to clean up — including a connection
   * handed back to the pool mid-failure. Contention is per phone number, so
   * two shoppers only ever wait on each other in the collision case below.
   *
   * The one `sql` escape hatch in this file, for the same reason `ProductDao`
   * has one: advisory locks have no query-builder equivalent. `hashtext` maps
   * the number onto the `bigint` the lock takes; a collision between two
   * numbers costs a little contention and nothing else, since the rows are
   * still filtered by `phone` inside the lock.
   *
   * `decide` is handed every send inside `since` and must be pure — it runs
   * with the lock held.
   */
  static async decideAndRecord<Decision extends { allowed: boolean }>(
    phone: string,
    since: Date,
    decide: (sentAt: Date[]) => Decision,
  ): Promise<Decision> {
    // `read committed` is pinned, not inherited. It is what lets the read
    // below see the previous holder's committed insert: a snapshot isolation
    // level takes its snapshot at the *first* statement — which is the lock
    // acquisition — so the read that follows would still be looking at the
    // world as it was before the wait, and the race would be back with every
    // test green. This must not depend on `default_transaction_isolation`.
    return db.transaction(
      async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`);

        const rows = await tx
          .select({ sentAt: otpSendLog.sentAt })
          .from(otpSendLog)
          .where(
            and(eq(otpSendLog.phone, phone), gte(otpSendLog.sentAt, since)),
          );

        const decision = decide(rows.map((row) => row.sentAt));
        if (decision.allowed) {
          await tx
            .insert(otpSendLog)
            .values({ id: crypto.randomUUID(), phone });
        }
        return decision;
      },
      { isolationLevel: 'read committed' },
    );
  }

  /** Drop every send older than `before`. Nothing else reads those rows. */
  static async prune(before: Date): Promise<void> {
    await db.delete(otpSendLog).where(lt(otpSendLog.sentAt, before));
  }
}
