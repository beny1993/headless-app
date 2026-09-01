import { describe, expect, it } from 'vitest';
import {
  evaluateOtpThrottle,
  OTP_HOURLY_SEND_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
} from './otp-throttle';

const NOW = new Date('2026-09-01T12:00:00.000Z');

/** `seconds` ago, as the send log would have recorded it. */
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('evaluateOtpThrottle', () => {
  it('allows the first code a number has ever been sent', () => {
    expect(evaluateOtpThrottle([], NOW)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  describe('resend cooldown', () => {
    it('denies a resend inside the cooldown', () => {
      const result = evaluateOtpThrottle([ago(10)], NOW);

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS - 10);
    });

    it('denies a resend one second before the cooldown ends', () => {
      expect(
        evaluateOtpThrottle([ago(OTP_RESEND_COOLDOWN_SECONDS - 1)], NOW)
          .allowed,
      ).toBe(false);
    });

    it('allows a resend exactly when the cooldown expires', () => {
      // The boundary the UI's countdown lands on. Off by one here and the
      // resend button becomes a button that reliably fails.
      expect(
        evaluateOtpThrottle([ago(OTP_RESEND_COOLDOWN_SECONDS)], NOW).allowed,
      ).toBe(true);
    });

    it('measures the cooldown from the most recent send, not the oldest', () => {
      const result = evaluateOtpThrottle([ago(600), ago(5)], NOW);

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS - 5);
    });

    it('does not care what order the log rows arrive in', () => {
      const ascending = evaluateOtpThrottle([ago(5), ago(600)], NOW);
      const descending = evaluateOtpThrottle([ago(600), ago(5)], NOW);

      expect(ascending).toEqual(descending);
    });

    it('reports at least one second, never zero, when it denies', () => {
      // A `Retry-After: 0` invites an immediate retry that is denied again.
      const result = evaluateOtpThrottle(
        [ago(OTP_RESEND_COOLDOWN_SECONDS - 0.4)],
        NOW,
      );

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hourly cap', () => {
    /** `count` sends spread out enough that only the cap can deny them. */
    const spacedSends = (count: number) =>
      Array.from({ length: count }, (_, i) => ago(120 + i * 300));

    it('allows a send when the window holds one fewer than the cap', () => {
      expect(
        evaluateOtpThrottle(spacedSends(OTP_HOURLY_SEND_LIMIT - 1), NOW)
          .allowed,
      ).toBe(true);
    });

    it('denies the send that would exceed the cap', () => {
      expect(
        evaluateOtpThrottle(spacedSends(OTP_HOURLY_SEND_LIMIT), NOW).allowed,
      ).toBe(false);
    });

    it('waits for the oldest send to leave the window, not a fixed hour', () => {
      // The cap is a rolling window. Telling someone to wait a full hour when
      // their oldest code is 59 minutes old is a lie the UI would repeat.
      const sends = [
        ago(OTP_SEND_WINDOW_SECONDS - 60),
        ...Array.from({ length: OTP_HOURLY_SEND_LIMIT - 1 }, (_, i) =>
          ago(200 + i * 100),
        ),
      ];

      const result = evaluateOtpThrottle(sends, NOW);

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('ignores sends that have already aged out of the window', () => {
      const expired = Array.from({ length: 20 }, (_, i) =>
        ago(OTP_SEND_WINDOW_SECONDS + 1 + i),
      );

      expect(evaluateOtpThrottle(expired, NOW).allowed).toBe(true);
    });

    it('counts a send exactly on the window edge as still inside it', () => {
      // Fail closed on the boundary: a row at exactly one hour is ambiguous,
      // and the safe reading of an abuse counter is the strict one.
      const sends = Array.from({ length: OTP_HOURLY_SEND_LIMIT }, (_, i) =>
        i === 0 ? ago(OTP_SEND_WINDOW_SECONDS) : ago(200 + i * 100),
      );

      expect(evaluateOtpThrottle(sends, NOW).allowed).toBe(false);
    });
  });

  describe('fails closed', () => {
    it('denies when the newest send is in the future', () => {
      // A clock stepping backwards, or a row written by a host running ahead.
      // Allowing here would hand out an unlimited budget for the skew's length.
      const result = evaluateOtpThrottle([new Date(NOW.getTime() + 60_000)], NOW);

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it('denies on the cooldown before it even reaches the cap', () => {
      // Both rules broken at once must not report the softer of the two.
      const sends = Array.from({ length: OTP_HOURLY_SEND_LIMIT }, () => ago(1));

      expect(evaluateOtpThrottle(sends, NOW).allowed).toBe(false);
    });
  });

  it('is honest about its own limits', () => {
    // These are the numbers the design note fixed; the UI countdown and the
    // deploy docs both quote them.
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(90);
    expect(OTP_HOURLY_SEND_LIMIT).toBe(5);
    expect(OTP_SEND_WINDOW_SECONDS).toBe(3600);
  });
});
