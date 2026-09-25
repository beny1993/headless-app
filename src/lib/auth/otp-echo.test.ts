// The gate here is an authentication bypass when it is wrong in the permissive
// direction, so every combination of the two switches is pinned — including
// the one that matters most, "flag on in an environment that sends real SMS".
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isOtpEchoEnabled,
  otpEchoResponseSchema,
  rememberOtp,
  takeOtp,
} from './otp-echo';

const PHONE = '+989121234567';

/** Both switches, so no test inherits the shell's environment. */
const setEnv = (flag: string, provider: string) => {
  vi.stubEnv('APP_CONFIG_SHOW_OTP_IN_UI', flag);
  vi.stubEnv('APP_CONFIG_SMS_PROVIDER', provider);
};

afterEach(() => {
  vi.unstubAllEnvs();
  takeOtp(PHONE);
});

describe('isOtpEchoEnabled', () => {
  it('is off when nothing is set — the shipped default', () => {
    setEnv('', '');
    expect(isOtpEchoEnabled()).toBe(false);
  });

  it('is on with the flag and the console driver — the staging case', () => {
    setEnv('true', 'console');
    expect(isOtpEchoEnabled()).toBe(true);
  });

  it('is on when the provider is unset, because that defaults to console', () => {
    setEnv('true', '');
    expect(isOtpEchoEnabled()).toBe(true);
  });

  it('stays off with a real SMS provider even when the flag is set', () => {
    // The production safety net: a flag that leaked into an environment which
    // actually texts people must not turn that environment into an oracle.
    setEnv('true', 'smsir');
    expect(isOtpEchoEnabled()).toBe(false);
  });

  it('refuses an unknown provider rather than guessing it is console', () => {
    setEnv('true', 'kavenegar');
    expect(() => isOtpEchoEnabled()).toThrow(/has no driver/);
  });

  it('takes only the string `true`', () => {
    for (const value of ['1', 'yes', 'TRUE', 'false']) {
      setEnv(value, 'console');
      expect(isOtpEchoEnabled()).toBe(false);
    }
  });

  it('reads a padded ` true ` as on, like every other flag', () => {
    setEnv(' true ', 'console');
    expect(isOtpEchoEnabled()).toBe(true);
  });
});

describe('rememberOtp / takeOtp', () => {
  it('hands back the code that was remembered', () => {
    setEnv('true', 'console');
    rememberOtp(PHONE, '482913');
    expect(takeOtp(PHONE)).toBe('482913');
  });

  it('remembers nothing while the echo is off', () => {
    setEnv('', 'console');
    rememberOtp(PHONE, '482913');
    // Read with the echo on, so this proves the *write* was refused rather
    // than the read: a gate only on `takeOtp` would leave codes in memory,
    // ready to be echoed the moment the flag flipped.
    setEnv('true', 'console');
    expect(takeOtp(PHONE)).toBeUndefined();
  });

  it('yields a code once — a second read is empty', () => {
    setEnv('true', 'console');
    rememberOtp(PHONE, '482913');
    takeOtp(PHONE);
    expect(takeOtp(PHONE)).toBeUndefined();
  });

  it('keeps numbers apart', () => {
    setEnv('true', 'console');
    rememberOtp(PHONE, '482913');
    rememberOtp('+989127654321', '111111');
    expect(takeOtp('+989127654321')).toBe('111111');
    expect(takeOtp(PHONE)).toBe('482913');
  });

  it('keeps only the latest code for a number', () => {
    setEnv('true', 'console');
    rememberOtp(PHONE, '482913');
    rememberOtp(PHONE, '111111');
    expect(takeOtp(PHONE)).toBe('111111');
  });
});

describe('otpEchoResponseSchema', () => {
  it('accepts the echoed body', () => {
    expect(
      otpEchoResponseSchema.parse({ message: 'code sent', devCode: '1' }),
    ).toEqual({ devCode: '1' });
  });

  it('rejects the production body, which carries no code', () => {
    expect(
      otpEchoResponseSchema.safeParse({ message: 'code sent' }).success,
    ).toBe(false);
  });
});
