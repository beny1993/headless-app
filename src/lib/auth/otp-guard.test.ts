import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTP_HOURLY_SEND_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
} from './otp-throttle';

const mocks = vi.hoisted(() => ({
  sentAtSince: vi.fn(),
  record: vi.fn(),
  prune: vi.fn(),
}));

vi.mock('@/db/dao/OtpSendLogDao', () => ({
  OtpSendLogDao: {
    sentAtSince: mocks.sentAtSince,
    record: mocks.record,
    prune: mocks.prune,
  },
}));

const { assertOtpSendAllowed, recordOtpSend } = await import('./otp-guard');

const PHONE = '+989121234567';
const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000);

describe('assertOtpSendAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sentAtSince.mockResolvedValue([]);
    mocks.record.mockResolvedValue(undefined);
    mocks.prune.mockResolvedValue(undefined);
  });

  it('lets a first-time number through', async () => {
    await expect(assertOtpSendAllowed(PHONE)).resolves.toBeUndefined();
  });

  it('asks the log only about this number', async () => {
    await assertOtpSendAllowed(PHONE);

    expect(mocks.sentAtSince).toHaveBeenCalledWith(PHONE, expect.any(Date));
  });

  it('only fetches the window the cap is counted over', async () => {
    await assertOtpSendAllowed(PHONE);

    const [, since] = mocks.sentAtSince.mock.calls[0]!;
    const windowSeconds = (Date.now() - (since as Date).getTime()) / 1000;
    expect(windowSeconds).toBeGreaterThanOrEqual(3595);
    expect(windowSeconds).toBeLessThanOrEqual(3605);
  });

  it('rejects a resend inside the cooldown with 429', async () => {
    mocks.sentAtSince.mockResolvedValue([secondsAgo(5)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      status: 'TOO_MANY_REQUESTS',
    });
  });

  it('rejects once the hourly cap is reached', async () => {
    mocks.sentAtSince.mockResolvedValue(
      Array.from({ length: OTP_HOURLY_SEND_LIMIT }, (_, i) =>
        secondsAgo(120 + i * 300),
      ),
    );

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      status: 'TOO_MANY_REQUESTS',
    });
  });

  it('tells the caller how long to wait', async () => {
    mocks.sentAtSince.mockResolvedValue([secondsAgo(10)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      body: { retryAfterSeconds: expect.any(Number) },
    });
  });

  it('answers in Persian — the message reaches the login screen', async () => {
    mocks.sentAtSince.mockResolvedValue([secondsAgo(10)]);

    await expect(assertOtpSendAllowed(PHONE)).rejects.toMatchObject({
      body: { message: expect.stringMatching(/[؀-ۿ]/) },
    });
  });

  it('allows the resend once the cooldown has passed', async () => {
    mocks.sentAtSince.mockResolvedValue([
      secondsAgo(OTP_RESEND_COOLDOWN_SECONDS + 1),
    ]);

    await expect(assertOtpSendAllowed(PHONE)).resolves.toBeUndefined();
  });

  it('denies when the log cannot be read', async () => {
    // Fail closed: an unreadable send log means the throttle is blind, and a
    // blind throttle that allows is an open SMS bill.
    mocks.sentAtSince.mockRejectedValue(new Error('connection refused'));

    await expect(assertOtpSendAllowed(PHONE)).rejects.toThrow();
  });

  it('writes nothing — deciding is not sending', async () => {
    await assertOtpSendAllowed(PHONE);

    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe('recordOtpSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(undefined);
    mocks.prune.mockResolvedValue(undefined);
  });

  it('logs the send against the number', async () => {
    await recordOtpSend(PHONE);

    expect(mocks.record).toHaveBeenCalledWith(PHONE);
  });

  it('prunes rows that no window can still reach', async () => {
    await recordOtpSend(PHONE);

    expect(mocks.prune).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = mocks.prune.mock.calls[0]![0] as Date;
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });

  it('still records when pruning fails', async () => {
    // Housekeeping must never cost a shopper their login.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.prune.mockRejectedValue(new Error('deadlock detected'));

    await expect(recordOtpSend(PHONE)).resolves.toBeUndefined();
    expect(mocks.record).toHaveBeenCalledWith(PHONE);
    warn.mockRestore();
  });

  it('propagates a failure to record — an uncounted send is a hole', async () => {
    mocks.record.mockRejectedValue(new Error('connection refused'));

    await expect(recordOtpSend(PHONE)).rejects.toThrow();
  });
});
