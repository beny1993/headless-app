// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/db';
import { otpSendLog } from '@/db/schema/auth';

/**
 * The OTP send log — the evidence the per-phone throttle reasons over.
 *
 * Reads and writes only; the decision itself is `evaluateOtpThrottle` in
 * `src/lib/auth/otp-throttle.ts`, which is a pure function so its boundaries
 * can be tested without a database.
 */
export class OtpSendLogDao {
  /**
   * When this number was sent a code, for every send at or after `since`.
   *
   * Returns instants, not rows: the caller only ever compares times, and the
   * throttle should not be able to grow a dependency on the log's shape.
   */
  static async sentAtSince(phone: string, since: Date): Promise<Date[]> {
    const rows = await db
      .select({ sentAt: otpSendLog.sentAt })
      .from(otpSendLog)
      .where(and(eq(otpSendLog.phone, phone), gte(otpSendLog.sentAt, since)));
    return rows.map((row) => row.sentAt);
  }

  /** Log one dispatched code. */
  static async record(phone: string): Promise<void> {
    await db.insert(otpSendLog).values({ id: crypto.randomUUID(), phone });
  }

  /** Drop every send older than `before`. Nothing else reads those rows. */
  static async prune(before: Date): Promise<void> {
    await db.delete(otpSendLog).where(lt(otpSendLog.sentAt, before));
  }
}
