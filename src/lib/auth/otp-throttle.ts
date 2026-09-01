// Per-phone throttling for OTP sends.
//
// Better Auth's own limiter is keyed by IP (verified in its source: the bucket
// key is `${ip}|${path}`), which does not bound the two things that actually
// hurt here — the SMS bill for one victim's handset, and the fact that every
// new code silently invalidates the one that victim is still holding, because
// the verification lookup takes the newest row for the identifier. An attacker
// on a handful of IPs stays under the IP budget while doing both.
//
// The decision is a pure function of the send log and the clock so that every
// boundary is testable without a database or a fake timer; `assertOtpSendAllowed`
// in ./otp-guard.ts is the thin part that talks to Postgres.

/** No second code inside this many seconds of the last one. */
export const OTP_RESEND_COOLDOWN_SECONDS = 90;

/** How many codes one number may be sent per {@link OTP_SEND_WINDOW_SECONDS}. */
export const OTP_HOURLY_SEND_LIMIT = 5;

/** The rolling window the cap is counted over. */
export const OTP_SEND_WINDOW_SECONDS = 3600;

export type OtpThrottleDecision = {
  allowed: boolean;
  /** Seconds until a send would be accepted. `0` only when allowed. */
  retryAfterSeconds: number;
};

const ALLOWED: OtpThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Never advertise a wait of zero on a denial: a client that honours it retries
 * immediately and is denied again. Round up, floor at one second.
 */
const deny = (seconds: number): OtpThrottleDecision => ({
  allowed: false,
  retryAfterSeconds: Math.max(1, Math.ceil(seconds)),
});

/**
 * Decide whether this number may be sent another code.
 *
 * `sentAt` is every logged send for the number; order does not matter and rows
 * older than the window are ignored, so the caller may over-fetch. A timestamp
 * in the future (clock skew, a host running ahead) denies rather than allows —
 * the alternative hands out an unbounded budget for the length of the skew.
 */
export function evaluateOtpThrottle(
  sentAt: readonly Date[],
  now: Date,
): OtpThrottleDecision {
  const nowMs = now.getTime();
  const timestamps = sentAt.map((date) => date.getTime());

  const newest = timestamps.length ? Math.max(...timestamps) : null;
  if (newest !== null) {
    const sinceNewestSeconds = (nowMs - newest) / 1000;
    if (sinceNewestSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      return deny(OTP_RESEND_COOLDOWN_SECONDS - sinceNewestSeconds);
    }
  }

  // Inclusive on the edge: a row sitting exactly on the boundary still counts.
  const windowStart = nowMs - OTP_SEND_WINDOW_SECONDS * 1000;
  const inWindow = timestamps.filter((time) => time >= windowStart);
  if (inWindow.length >= OTP_HOURLY_SEND_LIMIT) {
    // Wait only until the oldest send rolls out of the window, not a flat hour.
    const oldest = Math.min(...inWindow);
    return deny((oldest - windowStart) / 1000);
  }

  return ALLOWED;
}
