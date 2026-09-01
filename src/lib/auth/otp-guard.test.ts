import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTP_HOURLY_SEND_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
} from './otp-throttle';

const mocks = vi.hoisted(() => ({
  decideAndRecord: vi.fn(),
  prune: vi.fn(),
}));

vi.mock('@/db/dao/OtpSendLogDao', () => ({
  OtpSendLogDao: {
    decideAndRecord: mocks.decideAndRecord,
    prune: mocks.prune,
  },
}));

const { assertOtpSendAllowed } = await import('./otp-guard');

const PHONE = '+989121234567';
const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000);

/**
 * Stand in for the DAO's atomic step by running the caller's own `decide`
 * against `sends`. The real `evaluateOtpThrottle` therefore still decides —
 * only the transaction and the lock are faked, which is what
 * `OtpSendLogDao.integration.test.ts` covers against live Postgres instead.
 */
const logHolding = (sends: Date[]) =>
  mocks.decideAndRecord.mockImplementation(
    async (_phone: string, _since: Date, decide: (rows: Date[]) => unknown) =>
      decide(sends),
  );

describe('assertOtpSendAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logHolding([]);
    mocks.prune.mockResolvedValue(undefined);
  });

  it('lets a first-time number through', async () => {
    await expect(assertOtpSendAllowed(PHONE)).resolves.toBeUndefined();
  });

  it('decides and records in one call — never a read followed by a write', async () => {
    // The split version was a check-then-act race: a concurrent burst all read
    // the same empty log and all sent. Keeping this on one DAO call is what
    // makes the lock in `decideAndRecord` cover both halves.
    await assertOtpSendAllowed(PHONE);

    expect(mocks.decideAndRecord).toHaveBeenCalledTimes(1);
    expect(mocks.decideAndRecord).toHaveBeenCalledWith(
      PHONE,
      expect.any(Date),
      expect.any(Function),
    );
  });

  it('only considers the window the cap is counted over', async () => {
    await assertOtpSendAllowed(PHONE);

    const [, since] = mocks.decideAndRecord.mock.calls[0]!;
    const windowSeconds = (Date.now() - (since as Date).getTime()) / 1000;
    expect(windowSeconds).toBeGreaterThanOrEqual(3595);
    expect(windowSeconds).toBeLessThanOrEqual(3605);
  });

  it('rejects a resend inside the cooldown with 429', async () => {
    logHolding([secondsAgo(5)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      status: 'TOO_MANY_REQUESTS',
    });
  });

  it('rejects once the hourly cap is reached', async () => {
    logHolding(
      Array.from({ length: OTP_HOURLY_SEND_LIMIT }, (_, i) =>
        secondsAgo(120 + i * 300),
      ),
    );

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      status: 'TOO_MANY_REQUESTS',
    });
  });

  it('tells the caller how long to wait', async () => {
    logHolding([secondsAgo(10)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      body: { retryAfterSeconds: expect.any(Number) },
    });
  });

  it('answers in Persian — the message reaches the login screen', async () => {
    logHolding([secondsAgo(10)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      body: { message: expect.stringMatching(/[؀-ۿ]/) },
    });
  });

  it('allows the resend once the cooldown has passed', async () => {
    logHolding([secondsAgo(OTP_RESEND_COOLDOWN_SECONDS + 1)]);

    await expect(assertOtpSendAllowed(PHONE)).resolves.toBeUndefined();
  });

  it('propagates a failure to read the log rather than allowing the send', async () => {
    // Fail closed: an unreadable send log means the throttle is blind, and a
    // blind throttle that allows is an open SMS bill. The failure travels as
    // the original error, not a 429 — this is a broken database, not a
    // shopper who asked too often.
    mocks.decideAndRecord.mockRejectedValue(new Error('connection refused'));

    await expect(assertOtpSendAllowed(PHONE)).rejects.toThrow(
      'connection refused',
    );
  });

  it('prunes rows no window can still reach once a send is allowed', async () => {
    await assertOtpSendAllowed(PHONE);

    expect(mocks.prune).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = mocks.prune.mock.calls[0]![0] as Date;
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });

  it('does not prune when it refused — nothing was written', async () => {
    logHolding([secondsAgo(5)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toThrow();
    expect(mocks.prune).not.toHaveBeenCalled();
  });

  it('still lets the send through when pruning fails', async () => {
    // Housekeeping must never cost a shopper their login.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.prune.mockRejectedValue(new Error('deadlock detected'));

    await expect(assertOtpSendAllowed(PHONE)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
