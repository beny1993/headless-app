import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleSmsDriver,
  createSmsIrDriver,
  getSmsSender,
  newOrderMessage,
  newOrderSms,
  otpMessage,
  otpSms,
  sendOtpSms,
  SMS_PROVIDERS,
} from './index';

const PHONE = '+989121234567';

/** What the order-alert builder hands the seam — already Persian-formatted. */
const ORDER_PARAMS = {
  ORDER: '۱۰۲۴',
  AMOUNT: '۲٬۴۵۰٬۰۰۰ تومان',
  METHOD: 'کارت به کارت',
} as const;

describe('newOrderMessage', () => {
  it('carries the order number, the total and the method', () => {
    const message = newOrderMessage(ORDER_PARAMS);

    expect(message).toContain(ORDER_PARAMS.ORDER);
    expect(message).toContain(ORDER_PARAMS.AMOUNT);
    expect(message).toContain(ORDER_PARAMS.METHOD);
  });

  it('is written in Persian', () => {
    expect(newOrderMessage(ORDER_PARAMS)).toMatch(/[\u0600-\u06FF]/);
  });

  it('does not embed a link — an admin alert is not a place to click from', () => {
    expect(newOrderMessage(ORDER_PARAMS)).not.toContain('http');
  });
});

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
  // NODE_ENV is snapshotted at import time (`STATIC_INLINED_VARS` in env.ts),
  // so a case that depends on it stubs the environment and then re-imports the
  // module — the pattern in `env.test.ts`.
  const load = async (nodeEnv: string) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.resetModules();
    return import('./index');
  };

  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('prints the recipient and the message so a local QA run can read it', async () => {
    const sms = await load('development');

    await sms.consoleSmsDriver(PHONE, otpSms('482913'));

    expect(log).toHaveBeenCalledTimes(1);
    const printed = log.mock.calls[0]!.join(' ');
    expect(printed).toContain(PHONE);
    expect(printed).toContain('482913');
  });

  it('renders the Persian message itself — the seam carries only the code', async () => {
    const sms = await load('development');

    await sms.consoleSmsDriver(PHONE, otpSms('482913'));

    expect(log.mock.calls[0]!.join(' ')).toContain(otpMessage('482913'));
  });

  it('renders the new-order alert from its parameters', async () => {
    const sms = await load('development');

    await sms.consoleSmsDriver(PHONE, newOrderSms(ORDER_PARAMS));

    expect(log.mock.calls[0]!.join(' ')).toContain(
      newOrderMessage(ORDER_PARAMS),
    );
  });

  it('resolves — a driver that throws would fail the send-otp request', async () => {
    await expect(
      consoleSmsDriver(PHONE, otpSms('482913')),
    ).resolves.toBeUndefined();
  });

  // A deploy that forgets APP_CONFIG_SMS_PROVIDER runs this driver on the PaaS,
  // where the server log is the platform's log store. Printing the number and a
  // live code there hands every account away to whoever can read it.
  describe('outside development', () => {
    it.each(['production', 'test'])(
      'writes neither the code nor the number under NODE_ENV=%s',
      async (nodeEnv) => {
        const sms = await load(nodeEnv);

        await sms.consoleSmsDriver(PHONE, otpSms('482913'));

        const printed = log.mock.calls[0]!.join(' ');
        expect(printed).not.toContain('482913');
        expect(printed).not.toContain(PHONE);
        // Not one digit of either: no last-four tail, no partial number.
        expect(printed).not.toMatch(/[0-9]/);
      },
    );

    it('still says a code went out — silence would look like a broken driver', async () => {
      const sms = await load('production');

      await sms.consoleSmsDriver(PHONE, otpSms('482913'));

      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]!.join(' ')).toContain('[sms:console]');
    });

    it('points at the sanctioned way to read a code on a test deploy', async () => {
      // `docker logs` no longer carries it, so the staging escape hatch is
      // APP_CONFIG_SHOW_OTP_IN_UI (src/lib/auth/otp-echo.ts).
      const sms = await load('production');

      await sms.consoleSmsDriver(PHONE, otpSms('482913'));

      expect(log.mock.calls[0]!.join(' ')).toContain(
        'APP_CONFIG_SHOW_OTP_IN_UI',
      );
    });

    it.each(['production', 'test'])(
      'writes neither the order nor the number of a new-order alert under NODE_ENV=%s',
      async (nodeEnv) => {
        // The admin's number is as personal as a shopper's, and the payload has
        // no business in a platform-side log either.
        const sms = await load(nodeEnv);

        await sms.consoleSmsDriver(PHONE, newOrderSms(ORDER_PARAMS));

        const printed = log.mock.calls[0]!.join(' ');
        expect(printed).not.toContain(PHONE);
        for (const value of Object.values(ORDER_PARAMS)) {
          expect(printed).not.toContain(value);
        }
        // Not one digit in either script: no order number, no amount, no tail
        // of the admin's number.
        expect(printed).not.toMatch(/[0-9۰-۹]/);
      },
    );

    it('says which message went out — an order alert never reads as a sign-in code', async () => {
      // A staging log that reported every alert as a sign-in code would send
      // whoever reads it looking for a login that never happened.
      const sms = await load('production');

      await sms.consoleSmsDriver(PHONE, otpSms('482913'));
      await sms.consoleSmsDriver(PHONE, newOrderSms(ORDER_PARAMS));

      const otpLine = log.mock.calls[0]!.join(' ');
      const orderLine = log.mock.calls[1]!.join(' ');
      expect(orderLine).toContain('[sms:console]');
      expect(orderLine).not.toBe(otpLine);
    });

    it('resolves all the same — redaction must not fail the login', async () => {
      const sms = await load('production');

      await expect(
        sms.consoleSmsDriver(PHONE, otpSms('482913')),
      ).resolves.toBeUndefined();
    });
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
    expect(() => getSmsSender()).toThrow(
      'APP_CONFIG_SMS_PROVIDER="kavenegar" has no driver. Known providers: console, smsir.',
    );
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
    vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '100200');
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
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('sends the OTP message to the number that asked for it', async () => {
    // Read under development, the one mode where the console driver still
    // prints the payload — which is what makes the number and the code
    // observable at all. The redaction has its own cases above.
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const sms = await import('./index');

    await sms.sendOtpSms(PHONE, '482913');

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

  /** One SMS.ir reply, in the envelope api.sms.ir actually returns. */
  const reply = (status: number, httpStatus = 200, message = 'موفق') =>
    new Response(JSON.stringify({ data: null, status, message }), {
      status: httpStatus,
      headers: { 'content-type': 'application/json' },
    });

  const body = () => JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);

  beforeEach(() => {
    vi.stubEnv('APP_CONFIG_SMSIR_API_KEY', KEY);
    vi.stubEnv('APP_CONFIG_SMSIR_TEMPLATE_ID', '100200');
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
      await createSmsIrDriver()(PHONE, otpSms('482913'));

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.sms.ir/v1/send/verify');
      expect(init!.method).toBe('POST');
    });

    it('authenticates with the x-api-key header', async () => {
      await createSmsIrDriver()(PHONE, otpSms('482913'));

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
      await createSmsIrDriver()(PHONE, otpSms('482913'));

      expect(body().mobile).toBe('09121234567');
    });

    it('sends the template id as a number, as SMS.ir expects', async () => {
      await createSmsIrDriver()(PHONE, otpSms('482913'));

      expect(body().templateId).toBe(100200);
    });

    it('passes the code as the OTP template parameter', async () => {
      // The panel template substitutes #OTP#; a renamed parameter delivers an
      // SMS with the placeholder still in it.
      await createSmsIrDriver()(PHONE, otpSms('482913'));

      expect(body().parameters).toEqual([{ name: 'OTP', value: '482913' }]);
    });

    it('bounds the request so a wedged provider cannot hang the login', async () => {
      await createSmsIrDriver()(PHONE, otpSms('482913'));

      expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('the response', () => {
    it('resolves on status 1 — the code reached the gateway', async () => {
      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).resolves.toBeUndefined();
    });

    it('rejects on a non-success status, carrying SMS.ir’s reason', async () => {
      // api.sms.ir answers an invalid key with HTTP 401, status 10.
      fetchMock.mockResolvedValueOnce(
        reply(10, 401, 'کلید وب سرویس نامعتبر است'),
      );

      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).rejects.toThrow(/کلید وب سرویس نامعتبر است/);
    });

    it('rejects on an unknown template rather than reporting a send', async () => {
      // api.sms.ir answers an unknown template with HTTP 400, status 113.
      fetchMock.mockResolvedValueOnce(reply(113, 400, 'قالب یافت نشد'));

      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).rejects.toThrow(/113/);
    });

    it('caps how much of SMS.ir’s message it repeats', async () => {
      // The body is an untrusted string and this error reaches Sentry. A
      // provider outage page or a hostile proxy must not paste a novel into an
      // error report.
      fetchMock.mockResolvedValueOnce(reply(10, 401, 'خ'.repeat(5_000)));

      const error = await createSmsIrDriver()(PHONE, otpSms('482913')).catch(
        (caught: Error) => caught,
      );

      expect(String(error).length).toBeLessThan(400);
    });

    it('masks every digit run in SMS.ir’s reason, in any script', async () => {
      // The reason is free text from outside, and this error goes to Sentry.
      // A provider that echoes the number back must not carry it there — not
      // whole, not a tail in another script. The words stay: they are the
      // diagnosis. Arabic-Indic and full-width digits are escaped, not typed:
      // on the page they pass for the Persian and ASCII ones.
      const arabicIndic = '\u0660\u0669';
      const fullWidth = '\uFF10\uFF19';
      fetchMock.mockResolvedValueOnce(
        reply(
          10,
          400,
          `شماره 09121234567 با پایان ۴۵۶۷ یا ${arabicIndic} یا ${fullWidth} مجاز نیست`,
        ),
      );

      const error = await createSmsIrDriver()(PHONE, otpSms('482913')).catch(
        (caught: Error) => caught,
      );

      const text = String(error);
      expect(text).not.toContain('1234567');
      expect(text).not.toContain('۴۵۶۷');
      expect(text).not.toContain(arabicIndic);
      expect(text).not.toContain(fullWidth);
      expect(text).toContain('مجاز نیست');
    });

    it('rejects a body that is not SMS.ir’s envelope', async () => {
      // A proxy error page or an outage HTML body. Reporting success here
      // leaves the shopper waiting for an SMS that was never dispatched.
      fetchMock.mockResolvedValueOnce(
        new Response('<html>502</html>', { status: 502 }),
      );

      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).rejects.toThrow(/unrecognized/);
    });

    it('rejects a JSON body missing the status field', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
      );

      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).rejects.toThrow(/unrecognized/);
    });

    it.each([
      ['a non-success status', () => reply(10, 401, 'خطا')],
      ['an unrecognized body', () => new Response('nope', { status: 500 })],
    ])('leaks neither the code nor the number on %s', async (_label, make) => {
      // Send failures reach Sentry. An OTP or a phone number in the message is
      // exactly the leak src/lib/sentry.ts strips console breadcrumbs to avoid.
      fetchMock.mockResolvedValueOnce(make());

      const error = await createSmsIrDriver()(PHONE, otpSms('482913')).catch(
        (caught: Error) => caught,
      );

      expect(String(error)).not.toContain('482913');
      expect(String(error)).not.toContain(PHONE);
      expect(String(error)).not.toContain('09121234567');
      expect(String(error)).not.toContain(KEY);
    });
  });

  describe('the new-order template', () => {
    // The trap this pins: production flips APP_CONFIG_SMS_PROVIDER to `smsir`
    // before the second panel template has been created. Sign-in must keep
    // working — only the order alert may fail, and it must fail loudly.
    beforeEach(() => {
      vi.stubEnv('APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID', '');
    });

    it('builds the driver with no order template id set', () => {
      expect(createSmsIrDriver).not.toThrow();
    });

    it('still sends an OTP with no order template id set', async () => {
      await expect(
        createSmsIrDriver()(PHONE, otpSms('482913')),
      ).resolves.toBeUndefined();

      expect(body().templateId).toBe(100200);
    });

    it('rejects an order alert with no id set, naming the variable', async () => {
      await expect(
        createSmsIrDriver()(PHONE, newOrderSms(ORDER_PARAMS)),
      ).rejects.toThrow(/APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['abc', '12.5', '-1', '0'])(
      'refuses %j as an order template id',
      async (value) => {
        vi.stubEnv('APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID', value);

        await expect(
          createSmsIrDriver()(PHONE, newOrderSms(ORDER_PARAMS)),
        ).rejects.toThrow(/APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID/);
      },
    );

    it('posts the order template id, not the OTP one', async () => {
      vi.stubEnv('APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID', '300400');

      await createSmsIrDriver()(PHONE, newOrderSms(ORDER_PARAMS));

      expect(body().templateId).toBe(300400);
    });

    it('sends the order fields as named parameters, never as #OTP#', async () => {
      // A renamed parameter delivers an SMS with the placeholders still in it.
      vi.stubEnv('APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID', '300400');

      await createSmsIrDriver()(PHONE, newOrderSms(ORDER_PARAMS));

      expect(body().parameters).toEqual([
        { name: 'ORDER', value: ORDER_PARAMS.ORDER },
        { name: 'AMOUNT', value: ORDER_PARAMS.AMOUNT },
        { name: 'METHOD', value: ORDER_PARAMS.METHOD },
      ]);
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
