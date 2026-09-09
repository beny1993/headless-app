// The per-phone throttle, wired to the database. The decision itself lives in
// ./otp-throttle.ts; this is the thin layer that fetches the log and turns a
// denial into the 429 the login screen renders.
import { APIError } from 'better-auth/api';
import * as Sentry from '@sentry/nextjs';
import { OtpSendLogDao } from '@/db/dao/OtpSendLogDao';
import { evaluateOtpThrottle, OTP_SEND_WINDOW_SECONDS } from './otp-throttle';

const windowStart = (now: Date) =>
  new Date(now.getTime() - OTP_SEND_WINDOW_SECONDS * 1000);

/**
 * Throw a 429 unless this number may be sent another code — and count the send
 * in the same breath when it is allowed.
 *
 * Called from `hooks.before` on `/phone-number/send-otp` — deliberately *not*
 * from inside the plugin's `sendOTP` callback, which the design note originally
 * placed it in. By the time `sendOTP` runs, the endpoint has already written a
 * new verification row, and the verify lookup takes the newest row for the
 * number. Throttling there would still stop the SMS, but each blocked resend
 * would silently kill the code the shopper is holding — an attacker who knows a
 * victim's number could keep them permanently unable to log in.
 *
 * Deciding and recording are one atomic step (`decideAndRecord`) rather than a
 * check here and a write later: the gap between the two was a race that let a
 * concurrent burst past the cooldown entirely. The consequence is that a send
 * is counted before the SMS is handed to the driver, so a provider failure
 * costs the shopper one of their five hourly codes — the deliberate trade, on
 * the grounds that a message which goes out uncounted is worse than one that is
 * counted and then fails.
 *
 * Any failure reading the log propagates: a throttle that cannot see the log
 * cannot say "allowed".
 */
export async function assertOtpSendAllowed(phoneNumber: string): Promise<void> {
  const now = new Date();
  const decision = await OtpSendLogDao.decideAndRecord(
    phoneNumber,
    windowStart(now),
    (sends) => evaluateOtpThrottle(sends, now),
  );

  if (decision.allowed) {
    // Housekeeping, and only once the row that matters is committed. A failure
    // here must not cost a shopper their session.
    //
    // ponytail: pruning on every send is a full-table delete by `sent_at`,
    // which the `(phone, sent_at)` index does not serve. Fine at this table's
    // size — it only ever holds an hour of logins. Move it to a scheduled job
    // if the login path ever shows it.
    await OtpSendLogDao.prune(windowStart(new Date())).catch((error) => {
      console.warn('[auth] pruning otp_send_log failed', error);
      // Deliberately swallowed so a housekeeping failure never costs a shopper
      // their login — which is precisely why it needs reporting: unbounded
      // growth of this table is silent until the throttle query gets slow.
      Sentry.captureException(error);
    });
    return;
  }

  throw new APIError('TOO_MANY_REQUESTS', {
    message: 'برای درخواست کد جدید کمی صبر کن.',
    code: 'OTP_SEND_THROTTLED',
    retryAfterSeconds: decision.retryAfterSeconds,
  });
}
