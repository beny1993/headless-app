// The phone OTP flow end to end, against a live database — see src/db/test-db.ts.
//
// These drive `auth.handler` with real `Request`s, which is the same entry the
// Next route uses, so everything under test is the shipped path: the before
// hook, the plugin's own verification, the drizzle adapter, the rate limiter's
// database storage, and the console SMS driver. The code is read back through
// the staging echo (APP_CONFIG_SHOW_OTP_IN_UI, ./otp-echo.ts) — the sanctioned
// way to see a code without an SMS account, and the way a deployed test build
// does it, since the console driver redacts the code outside development.
import { faker } from '@faker-js/faker';
import { eq, inArray, like } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  accounts,
  otpSendLog,
  rateLimits,
  sessions,
  users,
  verificationTokens,
} from '@/db/schema/auth';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { auth } = await importWithDb(() => import('./index'));

const BASE = 'http://localhost:3000/api/auth';
const SEND = '/phone-number/send-otp';
const VERIFY = '/phone-number/verify';

/** A private range nothing else in the suite uses, so buckets never collide. */
let ipCounter = 0;
const freshIp = () =>
  `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

describe.skipIf(!databaseReachable)('phone OTP authentication', () => {
  const phones: string[] = [];

  /** A canonical Iranian mobile nobody else's test is using. */
  const freshPhone = () => {
    const value = `+9891${faker.string.numeric(8)}`;
    phones.push(value);
    return value;
  };

  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Read at request time, so stubbing it here is enough — no re-import.
    vi.stubEnv('APP_CONFIG_SHOW_OTP_IN_UI', 'true');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (phones.length === 0) return;
    // Test teardown, not an application path.
    await testDb.delete(users).where(inArray(users.phoneNumber, phones));
    await testDb
      .delete(verificationTokens)
      .where(inArray(verificationTokens.identifier, phones));
    await testDb.delete(otpSendLog).where(inArray(otpSendLog.phone, phones));
    phones.length = 0;
  });

  afterAll(async () => {
    if (!databaseReachable) return;
    await testDb.delete(rateLimits).where(like(rateLimits.key, '10.99.%'));
  });

  const post = (path: string, body: unknown, ip = freshIp()) =>
    auth.handler(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify(body),
      }),
    );

  /**
   * The code just dispatched, read back off the send-otp response.
   *
   * That field is the staging echo (`devCode`, ./otp-echo.ts), switched on for
   * this suite. It used to be scraped out of the console driver's log line;
   * outside development that line no longer carries the code, which is exactly
   * the property the driver's own suite pins.
   */
  const sentCode = async (response: Response) => {
    const body = (await response.clone().json()) as { devCode?: string };
    return body.devCode ?? null;
  };

  /** Send a code and hand back the number and the code that was dispatched. */
  const requestCode = async (ip = freshIp()) => {
    const phone = freshPhone();
    const response = await post(SEND, { phoneNumber: phone }, ip);
    expect(response.status).toBe(200);
    const code = await sentCode(response);
    expect(code).toMatch(/^\d{6}$/);
    return { phone, code: code!, ip };
  };

  describe('requesting a code', () => {
    it('dispatches a six digit code and says so', async () => {
      const { code } = await requestCode();

      expect(code).toHaveLength(6);
    });

    it('says a code went out without writing it, or the number, to the log', async () => {
      // The console driver is the shipped default until a provider is chosen,
      // so a deploy that forgets APP_CONFIG_SMS_PROVIDER runs it — and there
      // the server log is the platform's log store. Under `next dev` the line
      // still carries both; this suite is not `next dev`, and neither is a
      // container. (The driver's own cases live in src/lib/sms/index.test.ts.)
      const { phone, code } = await requestCode();
      const printed = log.mock.calls
        .map((call: unknown[]) => call.join(' '))
        .join('\n');

      expect(printed).toContain('[sms:console]');
      expect(printed).not.toContain(phone);
      expect(printed).not.toContain(code);
    });

    it('logs the send against the number for the throttle to count', async () => {
      const { phone } = await requestCode();

      const logged = await testDb
        .select()
        .from(otpSendLog)
        .where(eq(otpSendLog.phone, phone));
      expect(logged).toHaveLength(1);
    });

    it('creates no user until a code is verified', async () => {
      const { phone } = await requestCode();

      expect(
        await testDb.select().from(users).where(eq(users.phoneNumber, phone)),
      ).toEqual([]);
    });
  });

  describe('verifying a code', () => {
    it('issues a session', async () => {
      // The `Set-Cookie` header itself is not observable here — happy-dom's
      // `Response` filters it — so this checks the session that header would
      // carry. The cookie's own flags are verified in the browser at review.
      const { phone, code } = await requestCode();

      const response = await post(VERIFY, { phoneNumber: phone, code });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: true,
        token: expect.any(String),
      });
    });

    it('gives that session thirty days', async () => {
      // Every re-login costs an SMS, so the session length is a real cost
      // decision, not a default nobody read.
      const { phone, code } = await requestCode();
      await post(VERIFY, { phoneNumber: phone, code });

      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      const [session] = await testDb
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user!.id));

      const days =
        (session!.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(days).toBeGreaterThan(29.5);
      expect(days).toBeLessThanOrEqual(30);
    });

    it('creates the account as a customer, never an admin', async () => {
      const { phone, code } = await requestCode();

      await post(VERIFY, { phoneNumber: phone, code });

      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.role).toBe('customer');
    });

    it('refuses a role posted alongside the code', async () => {
      // `/phone-number/verify`'s body schema ends in `.and(z.record(...))`, so
      // extra fields reach `parseUserInput` on the create path. `input: false`
      // on the role field is the only thing standing here — and this is the
      // request an attacker would actually send.
      const { phone, code } = await requestCode();

      const response = await post(VERIFY, {
        phoneNumber: phone,
        code,
        role: 'admin',
      });

      expect(response.status).toBe(200);
      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.role).toBe('customer');
    });

    it('marks the number verified and stores it canonically', async () => {
      const { phone, code } = await requestCode();

      await post(VERIFY, { phoneNumber: phone, code });

      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.phoneNumberVerified).toBe(true);
      expect(user!.phoneNumber).toBe(phone);
    });

    it('gives the account an address no mail can reach', async () => {
      const { phone, code } = await requestCode();

      await post(VERIFY, { phoneNumber: phone, code });

      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.email).toBe(
        `${phone.replace('+', '')}@phone.smokey.invalid`,
      );
    });

    it('signs a returning customer into the same account', async () => {
      const { phone, code } = await requestCode();
      await post(VERIFY, { phoneNumber: phone, code });
      const [first] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));

      // Second login, months later: a new code, the same person.
      await testDb.delete(otpSendLog).where(eq(otpSendLog.phone, phone));
      const second = await post(SEND, { phoneNumber: phone });
      await post(VERIFY, {
        phoneNumber: phone,
        code: (await sentCode(second))!,
      });

      const all = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(first!.id);
    });
  });

  describe('a code is single use', () => {
    it('rejects a code that has already been redeemed', async () => {
      const { phone, code } = await requestCode();
      expect((await post(VERIFY, { phoneNumber: phone, code })).status).toBe(
        200,
      );

      const replay = await post(VERIFY, { phoneNumber: phone, code });

      expect(replay.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a code that has expired', async () => {
      const { phone, code } = await requestCode();
      // Two minutes of real waiting, bought for one UPDATE.
      await testDb
        .update(verificationTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(verificationTokens.identifier, phone));

      const response = await post(VERIFY, { phoneNumber: phone, code });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(
        await testDb.select().from(users).where(eq(users.phoneNumber, phone)),
      ).toEqual([]);
    });

    it('rejects a wrong code', async () => {
      const { phone, code } = await requestCode();
      const wrong = code === '111111' ? '222222' : '111111';

      const response = await post(VERIFY, { phoneNumber: phone, code: wrong });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('creates no account on a wrong code', async () => {
      const { phone } = await requestCode();

      await post(VERIFY, { phoneNumber: phone, code: '000000' });

      expect(
        await testDb.select().from(users).where(eq(users.phoneNumber, phone)),
      ).toEqual([]);
    });
  });

  describe('attempt budget', () => {
    it('kills the code after three wrong guesses', async () => {
      const { phone, code } = await requestCode();
      const wrong = code === '111111' ? '222222' : '111111';

      for (let attempt = 0; attempt < 3; attempt++) {
        expect(
          (await post(VERIFY, { phoneNumber: phone, code: wrong })).status,
        ).toBeGreaterThanOrEqual(400);
      }

      // The real code is now worthless — the budget, not the code, ran out.
      const response = await post(VERIFY, { phoneNumber: phone, code });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(
        await testDb.select().from(users).where(eq(users.phoneNumber, phone)),
      ).toEqual([]);
    });

    it('leaves nothing behind to guess against', async () => {
      const { phone } = await requestCode();

      for (let attempt = 0; attempt < 4; attempt++) {
        await post(VERIFY, { phoneNumber: phone, code: '000000' });
      }

      expect(
        await testDb
          .select()
          .from(verificationTokens)
          .where(eq(verificationTokens.identifier, phone)),
      ).toEqual([]);
    });

    it('still accepts the right code within the budget', async () => {
      const { phone, code } = await requestCode();

      await post(VERIFY, { phoneNumber: phone, code: '000000' });
      await post(VERIFY, { phoneNumber: phone, code: '000001' });
      const response = await post(VERIFY, { phoneNumber: phone, code });

      expect(response.status).toBe(200);
    });
  });

  describe('canonical form only', () => {
    it.each([
      ['national with a leading zero', '09121234567'],
      ['no country code at all', '9121234567'],
      ['Persian digits', '۰۹۱۲۱۲۳۴۵۶۷'],
      ['country code without the plus', '989121234567'],
      ['spaces inside the number', '+98 912 123 4567'],
    ])(
      'refuses to send a code to a number written as %s',
      async (_l, input) => {
        const response = await post(SEND, { phoneNumber: input });

        expect(response.status).toBe(400);
      },
    );

    it('refuses to verify against a non-canonical number', async () => {
      const response = await post(VERIFY, {
        phoneNumber: '09121234567',
        code: '123456',
      });

      expect(response.status).toBe(400);
    });

    it('never lets one human hold two accounts', async () => {
      // The whole point of canonical-only. If the loose form were accepted and
      // stored as sent, `09121234567` would be a second row beside
      // `+989121234567` under a unique index that cannot see the duplicate.
      const { phone, code } = await requestCode();
      await post(VERIFY, { phoneNumber: phone, code });

      const local = `0${phone.slice('+98'.length)}`;
      expect((await post(SEND, { phoneNumber: local })).status).toBe(400);

      expect(
        await testDb.select().from(users).where(eq(users.phoneNumber, local)),
      ).toEqual([]);
    });

    it('rejects a landline', async () => {
      expect((await post(SEND, { phoneNumber: '+982112345678' })).status).toBe(
        400,
      );
    });

    it('rejects a missing phone number without a 500', async () => {
      expect((await post(SEND, {})).status).toBe(400);
    });
  });

  describe('per-phone throttle', () => {
    it('refuses a second code inside the cooldown', async () => {
      const { phone, ip } = await requestCode();

      // Same IP deliberately: this must be the *phone* rule that fires, and
      // the IP budget is 3, so the second request is still inside it.
      const response = await post(SEND, { phoneNumber: phone }, ip);

      expect(response.status).toBe(429);
    });

    it('throttles the same number across different IPs', async () => {
      // The rule Better Auth cannot express. An attacker with a pool of
      // addresses would otherwise bill the SMS account without limit.
      const { phone } = await requestCode();

      const response = await post(SEND, { phoneNumber: phone }, freshIp());

      expect(response.status).toBe(429);
    });

    it('does not invalidate the code the shopper is holding', async () => {
      // The reason the throttle runs in `hooks.before` rather than in
      // `sendOTP`: the endpoint writes the verification row *before* calling
      // the sender, and verification reads the newest row for a number. A
      // refusal placed later would leave the victim with a dead code.
      const { phone, code } = await requestCode();

      expect((await post(SEND, { phoneNumber: phone })).status).toBe(429);

      expect((await post(VERIFY, { phoneNumber: phone, code })).status).toBe(
        200,
      );
    });

    it('sends nothing when it refuses', async () => {
      const { phone } = await requestCode();
      const before = log.mock.calls.length;

      await post(SEND, { phoneNumber: phone });

      expect(log.mock.calls.length).toBe(before);
    });

    it('lets the number through once the cooldown has passed', async () => {
      const { phone } = await requestCode();
      // Age the log rather than sleep for ninety seconds.
      await testDb
        .update(otpSendLog)
        .set({ sentAt: new Date(Date.now() - 91_000) })
        .where(eq(otpSendLog.phone, phone));

      expect((await post(SEND, { phoneNumber: phone })).status).toBe(200);
    });

    it('stops at five codes an hour', async () => {
      const { phone } = await requestCode();
      // Four more sends, all outside the cooldown but inside the hour.
      for (let i = 0; i < 4; i++) {
        await testDb
          .update(otpSendLog)
          .set({ sentAt: new Date(Date.now() - 100_000 - i) })
          .where(eq(otpSendLog.phone, phone));
        expect((await post(SEND, { phoneNumber: phone })).status).toBe(200);
      }

      // Five are now on the clock; age them all past the cooldown.
      await testDb
        .update(otpSendLog)
        .set({ sentAt: new Date(Date.now() - 120_000) })
        .where(eq(otpSendLog.phone, phone));

      expect((await post(SEND, { phoneNumber: phone })).status).toBe(429);
    });
  });

  describe('per-IP rate limit', () => {
    it('cuts one address off after three code requests a minute', async () => {
      const ip = freshIp();

      for (let i = 0; i < 3; i++) {
        const phone = freshPhone();
        expect((await post(SEND, { phoneNumber: phone }, ip)).status).toBe(200);
      }

      // A fourth number, same address: the phone throttle cannot see this one.
      const response = await post(SEND, { phoneNumber: freshPhone() }, ip);

      expect(response.status).toBe(429);
    });

    it('leaves another address alone', async () => {
      const ip = freshIp();
      for (let i = 0; i < 4; i++) {
        await post(SEND, { phoneNumber: freshPhone() }, ip);
      }

      const response = await post(SEND, { phoneNumber: freshPhone() });

      expect(response.status).toBe(200);
    });

    it('keeps its buckets in the database, not in this process', () => {
      // Proves the buckets really landed in Postgres rather than in this
      // process's memory — the storage choice the scaffold's security review
      // asked for, since a per-process store resets on redeploy and hands out
      // one budget per instance behind a load balancer. (An unregistered model
      // would not get this far: the adapter throws from `onRequest`.)
      return expect(
        testDb.select().from(rateLimits).where(like(rateLimits.key, '10.99.%')),
      ).resolves.not.toEqual([]);
    });
  });

  describe('no password flow exists', () => {
    it.each([
      '/sign-in/phone-number',
      '/phone-number/request-password-reset',
      '/phone-number/reset-password',
    ])('%s is not reachable', async (path) => {
      const response = await post(path, {
        phoneNumber: '+989121234567',
        password: 'hunter2hunter2',
        newPassword: 'hunter2hunter2',
        otp: '123456',
      });

      expect(response.status).toBe(404);
    });

    it('leaves no credential behind for a password login to use', async () => {
      const { phone, code } = await requestCode();
      await post(VERIFY, { phoneNumber: phone, code });

      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.role).toBe('customer');

      // The `account` row is what `sign-in/phone-number` verifies against, so
      // it is the thing to assert on: a phone sign-up must create no credential
      // at all. Checking only that the endpoint 404s would keep passing if a
      // future upgrade started minting one.
      const credentials = await testDb
        .select()
        .from(accounts)
        .where(eq(accounts.userId, user!.id));
      expect(credentials).toEqual([]);
    });
  });

  describe('one number, one identity', () => {
    // `user.email` is derived from the phone number and the column is unique,
    // so the two are one identity — but only the sign-up path maintains that.
    // Every endpoint that could move `phone_number` while leaving `email`
    // behind has to be shut, or the vacated number can never sign up again:
    // its derived address is still held by the row that walked away from it.

    it('refuses a verify that carries updatePhoneNumber, session or not', async () => {
      // Rejected in `hooks.before`, which runs ahead of the endpoint — so the
      // phone-change branch is unreachable whether or not a session is
      // attached, and a blocked attempt costs the caller nothing: the OTP is
      // not consumed and the account is untouched. Asserting it without a
      // cookie is the stronger statement, not a weaker one.
      const { phone, code } = await requestCode();
      const response = await post(VERIFY, {
        phoneNumber: phone,
        code,
        updatePhoneNumber: true,
      });

      expect(response.status).toBe(400);

      // The code survived the refusal: the same one still signs in.
      expect((await post(VERIFY, { phoneNumber: phone, code })).status).toBe(
        200,
      );
      const [user] = await testDb
        .select()
        .from(users)
        .where(eq(users.phoneNumber, phone));
      expect(user!.phoneNumber).toBe(phone);
    });

    it('does not expose /update-user, which can null a phone number', async () => {
      // The plugin guards phone edits with `phoneNumber !== null`, so a null
      // walks through and strands the derived email on a row with no number.
      const response = await post('/update-user', { phoneNumber: null });

      expect(response.status).toBe(404);
    });
  });
});
