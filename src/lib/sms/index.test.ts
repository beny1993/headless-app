import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleSmsDriver,
  createSmsIrDriver,
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
    await consoleSmsDriver(PHONE, '482913');

    expect(log).toHaveBeenCalledTimes(1);
    const printed = log.mock.calls[0]!.join(' ');
    expect(printed).toContain(PHONE);
    expect(printed).toContain('482913');
  });

  it('renders the Persian message itself — the seam carries only the code', async () => {
    await consoleSmsDriver(PHONE, '482913');

    expect(log.mock.calls[0]!.join(' ')).toContain(otpMessage('482913'));
  });

  it('resolves — a driver that throws would fail the send-otp request', async () => {
    await expect(consoleSmsDriver(PHONE, '482913')).resolves.toBeUndefined();
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

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'refuses %j, which is inherited from Object.prototype and not a driver',
    (inherited) => {
      // The driver table is an object literal, so a plain lookup would resolve
      // these to functions, pass the "is there a driver?" check, and "send"
      // every code into the void — the exact silent failure the throw exists
      // to prevent, reachable from a typo in an env file.
      vi.stubEnv('APP_CONFIG_SMS_PROVIDER', inherited);
      expect(() => getSmsSender()).toThrow(new RegExp(inherited));
    },
  );

  it('trims a padded provider name', () => {
    // `APP_CONFIG_SMS_PROVIDER=console ` is an easy paste into a PaaS env
    // field, and an untrimmed value would throw on every send.
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', '  console  ');
    expect(getSmsSender()).toBe(consoleSmsDriver);
  });

  it('treats a whitespace-only setting as unset', () => {
    // Distinct from the padded case above: here there is no name left after
    // trimming, so it is the fallback to the default that has to catch it.
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', '   ');
    expect(getSmsSender()).toBe(consoleSmsDriver);
  });

  it('lists console among the providers it knows', () => {
    expect(SMS_PROVIDERS).toContain('console');
  });

  it('lists smsir — the picked real provider', () => {
    expect(SMS_PROVIDERS).toContain('smsir');
  });

  it('does not read SMS.ir config under the console default', () => {
    // The drivers are factories precisely so the shipped default never touches
    // provider credentials. If it did, a fresh clone with no SMS.ir account
    // would throw on the first login instead of printing the code.
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'console');
    vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', '');
    vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '');
    expect(getSmsSender()).toBe(consoleSmsDriver);
  });

  it('builds the SMS.ir driver when the provider names it', () => {
    vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'smsir');
    vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', 'test-key');
    vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '123456');
    expect(getSmsSender()).not.toBe(consoleSmsDriver);
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

describe('createSmsIrDriver', () => {
  const KEY = 'test-key';
  let fetchMock: ReturnType<typeof vi.fn>;

  /** One SMS.ir reply, in the envelope the live sandbox actually returns. */
  const reply = (status: number, httpStatus = 200, message = 'موفق') =>
    new Response(JSON.stringify({ data: null, status, message }), {
      status: httpStatus,
      headers: { 'content-type': 'application/json' },
    });

  const body = () => JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);

  beforeEach(() => {
    vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', KEY);
    vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '123456');
    fetchMock = vi.fn(async () => reply(1));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('credentials', () => {
    it('refuses to build without an API key, naming the variable', () => {
      // The loud failure. The quiet alternative is a deploy that names smsir,
      // has no key, and reports every login as sent.
      vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', '');
      expect(createSmsIrDriver).toThrow(/APP_CONFIG_SMSIR_API_KEY/);
    });

    it('treats a whitespace-only API key as unset', () => {
      vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', '   ');
      expect(createSmsIrDriver).toThrow(/APP_CONFIG_SMSIR_API_KEY/);
    });

    it('trims a padded API key rather than sending the spaces', () => {
      // An easy paste into a PaaS env field; untrimmed it is a 401 on every
      // login with nothing in the message saying why.
      vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', `  ${KEY}  `);
      expect(createSmsIrDriver).not.toThrow();
    });

    it('refuses to build without a template id', () => {
      vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '');
      expect(createSmsIrDriver).toThrow(/APP_CONFIG_SMSIR_TEMPLATE_ID/);
    });

    it.each(['abc', '12.5', '-1', '0'])(
      'refuses %j as a template id',
      (value) => {
        // `Number('')`/`Number('0')` are 0, not an error — SMS.ir would answer
        // "قالب یافت نشد" on every send instead of failing at boot.
        vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', value);
        expect(createSmsIrDriver).toThrow(/APP_CONFIG_SMSIR_TEMPLATE_ID/);
      },
    );
  });

  describe('the request', () => {
    it('posts to the SMS.ir verify endpoint', async () => {
      await createSmsIrDriver()(PHONE, '482913');

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.sms.ir/v1/send/verify');
      expect(init!.method).toBe('POST');
    });

    it('authenticates with the x-api-key header', async () => {
      await createSmsIrDriver()(PHONE, '482913');

      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<
        string,
        string
      >;
      expect(headers['x-api-key']).toBe(KEY);
      expect(headers['content-type']).toBe('application/json');
    });

    it('sends the national 09… form, not the canonical +98…', async () => {
      // Storage is canonical E.164; SMS.ir reads the local form. Sending the
      // stored string verbatim is the bug this pins.
      await createSmsIrDriver()(PHONE, '482913');

      expect(body().mobile).toBe('09121234567');
    });

    it('sends the template id as a number, as SMS.ir expects', async () => {
      await createSmsIrDriver()(PHONE, '482913');

      expect(body().templateId).toBe(123456);
    });

    it('passes the code as the CODE template parameter', async () => {
      // The panel template substitutes #CODE#; a renamed parameter delivers an
      // SMS with the placeholder still in it.
      await createSmsIrDriver()(PHONE, '482913');

      expect(body().parameters).toEqual([{ name: 'CODE', value: '482913' }]);
    });

    it('bounds the request so a wedged provider cannot hang the login', async () => {
      await createSmsIrDriver()(PHONE, '482913');

      expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('the response', () => {
    it('resolves on status 1 — the code reached the gateway', async () => {
      await expect(
        createSmsIrDriver()(PHONE, '482913'),
      ).resolves.toBeUndefined();
    });

    it('rejects on a non-success status, carrying SMS.ir’s reason', async () => {
      // Live sandbox: an invalid key is HTTP 401 status 10.
      fetchMock.mockResolvedValueOnce(
        reply(10, 401, 'کلید وب سرویس نامعتبر است'),
      );

      await expect(createSmsIrDriver()(PHONE, '482913')).rejects.toThrow(
        /کلید وب سرویس نامعتبر است/,
      );
    });

    it('rejects on an unknown template rather than reporting a send', async () => {
      // Live sandbox: HTTP 400 status 113.
      fetchMock.mockResolvedValueOnce(reply(113, 400, 'قالب یافت نشد'));

      await expect(createSmsIrDriver()(PHONE, '482913')).rejects.toThrow(/113/);
    });

    it('rejects a body that is not SMS.ir’s envelope', async () => {
      // A proxy error page or an outage HTML body. Reporting success here
      // leaves the shopper waiting for an SMS that was never dispatched.
      fetchMock.mockResolvedValueOnce(
        new Response('<html>502</html>', { status: 502 }),
      );

      await expect(createSmsIrDriver()(PHONE, '482913')).rejects.toThrow(
        /unrecognized/,
      );
    });

    it('rejects a JSON body missing the status field', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
      );

      await expect(createSmsIrDriver()(PHONE, '482913')).rejects.toThrow(
        /unrecognized/,
      );
    });

    it.each([
      ['a non-success status', () => reply(10, 401, 'خطا')],
      ['an unrecognized body', () => new Response('nope', { status: 500 })],
    ])('leaks neither the code nor the number on %s', async (_label, make) => {
      // Send failures reach Sentry. An OTP or a phone number in the message is
      // exactly the leak src/lib/sentry.ts strips console breadcrumbs to avoid.
      fetchMock.mockResolvedValueOnce(make());

      const error = await createSmsIrDriver()(PHONE, '482913').catch(
        (caught: Error) => caught,
      );

      expect(String(error)).not.toContain('482913');
      expect(String(error)).not.toContain(PHONE);
      expect(String(error)).not.toContain('09121234567');
      expect(String(error)).not.toContain(KEY);
    });
  });

  describe('through sendOtpSms', () => {
    it('dispatches the configured provider, not the console driver', async () => {
      vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'smsir');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      await sendOtpSms(PHONE, '482913');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    });

    it('propagates an SMS.ir refusal instead of reporting a phantom send', async () => {
      vi.stubEnv('APP_CONFIG_SMS_PROVIDER', 'smsir');
      fetchMock.mockResolvedValueOnce(reply(10, 401, 'خطا'));

      await expect(sendOtpSms(PHONE, '482913')).rejects.toThrow();
    });
  });
});
