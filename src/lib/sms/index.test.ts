import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleSmsDriver,
  getSmsSender,
  otpMessage,
  sendOtpSms,
  SMS_PROVIDERS,
} from './index';

const PHONE = '+989121234567';

describe('otpMessage', () => {
  it('carries the code so the shopper can read it off the notification', () => {
    expect(otpMessage('482913')).toContain('482913');
  });

  it('is written in Persian', () => {
    expect(otpMessage('482913')).toMatch(/[؀-ۿ]/);
  });

  it('keeps the code in ASCII digits — it has to be typed back verbatim', () => {
    // Persian digits here would arrive on the handset as glyphs the shopper
    // then has to transliterate. The verify endpoint compares ASCII.
    expect(otpMessage('482913')).not.toMatch(/[۰-۹]/);
  });

  it('does not embed a link — SMS phishing training says codes travel alone', () => {
    expect(otpMessage('482913')).not.toContain('http');
  });
});

describe('consoleSmsDriver', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('prints the recipient and the message so a local QA run can read it', async () => {
    await consoleSmsDriver(PHONE, 'کد ورود شما: 482913');

    expect(log).toHaveBeenCalledTimes(1);
    const printed = log.mock.calls[0]!.join(' ');
    expect(printed).toContain(PHONE);
    expect(printed).toContain('482913');
  });

  it('resolves — a driver that throws would fail the send-otp request', async () => {
    await expect(consoleSmsDriver(PHONE, 'x')).resolves.toBeUndefined();
  });
});

describe('getSmsSender', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults to the console driver — the shipped default until a provider is picked', () => {
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', '');
    expect(getSmsSender()).toBe(consoleSmsDriver);
  });

  it('honours an explicit console setting', () => {
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'console');
    expect(getSmsSender()).toBe(consoleSmsDriver);
  });

  it('refuses a provider it has no driver for, naming it', () => {
    // The failure mode this prevents: a deploy sets the variable to the
    // provider that was finally chosen, no adapter exists yet, and every login
    // silently succeeds while sending nothing.
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'kavenegar');
    expect(() => getSmsSender()).toThrow(/kavenegar/);
  });

  it('refuses an unknown provider rather than falling back to console', () => {
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'carrier-pigeon');
    expect(() => getSmsSender()).toThrow();
  });

  it('lists console among the providers it knows', () => {
    expect(SMS_PROVIDERS).toContain('console');
  });
});

describe('sendOtpSms', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends the OTP message to the number that asked for it', async () => {
    await sendOtpSms(PHONE, '482913');

    const printed = log.mock.calls[0]!.join(' ');
    expect(printed).toContain(PHONE);
    expect(printed).toContain('482913');
  });

  it('propagates a driver failure instead of reporting a phantom send', async () => {
    // If this swallowed, the shopper would sit on the code screen forever
    // waiting for an SMS that was never dispatched.
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'kavenegar');
    await expect(sendOtpSms(PHONE, '482913')).rejects.toThrow();
  });
});
