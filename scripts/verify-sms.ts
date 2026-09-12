/**
 * One-off live check of the SMS.ir driver against the REAL provider.
 *
 *   pnpm verify-sms 09121234567
 *
 * It dispatches one throwaway code through the same `sendOtpSms` the login
 * endpoint calls, so a pass proves the whole chain: the key is accepted, the
 * template id exists, the `#CODE#` parameter substitutes, and the number is
 * reachable. The mocked unit tests cannot check any of that.
 *
 * NOT part of `pnpm test` — it needs real credentials and sends a real message.
 * Requires, in `.env`: APP_CONFIG_SMSIR_API_KEY and APP_CONFIG_SMSIR_TEMPLATE_ID.
 * It forces the `smsir` driver regardless of APP_CONFIG_SMS_PROVIDER, so the
 * console default stays the local login path and this stays an explicit act.
 */
import 'dotenv/config';
import { normalizeIranPhone } from '@/lib/auth/phone';
import { sendOtpSms } from '@/lib/sms';
import { getEnvVariable, VARS } from '@/lib/utils/env';

/** SMS.ir's stock sandbox template. A real account never has this id. */
const SANDBOX_TEMPLATE_ID = '123456';

const input = process.argv[2];
if (!input) {
  console.error(
    'usage: pnpm verify-sms <phone>   e.g. pnpm verify-sms 09121234567',
  );
  process.exit(1);
}

const phone = normalizeIranPhone(input);
if (!phone) {
  console.error(`"${input}" is not an Iranian mobile number.`);
  process.exit(1);
}

// The driver is chosen by env; this script exists to exercise the real one.
process.env[VARS.APP_CONFIG_SMS_PROVIDER] = 'smsir';

const main = async () => {
  const templateId = getEnvVariable(
    VARS.APP_CONFIG_SMSIR_TEMPLATE_ID,
    false,
    '',
  ).trim();
  // Fingerprint only — the key itself never reaches stdout, which may be a CI log.
  const key = getEnvVariable(VARS.APP_CONFIG_SMSIR_API_KEY, false, '').trim();
  console.log(`→ template  ${templateId || '(unset)'}`);
  console.log(
    `→ key       ${key ? `${key.slice(0, 4)}… (${key.length} chars)` : '(unset)'}`,
  );
  console.log(`→ to        ${phone}`);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await sendOtpSms(phone, code);

  console.log(`\n✓ SMS.ir accepted the send (code ${code}).`);

  if (templateId === SANDBOX_TEMPLATE_ID) {
    console.log(
      '\n⚠ Template 123456 is SMS.ir’s SANDBOX template. The sandbox key returns a\n' +
        '  canned success (always messageId 89545112) and dispatches NOTHING — no SMS\n' +
        '  will arrive. Swap in the production key and your own approved template id.',
    );
  } else {
    console.log('  Check the handset: it should arrive within a minute.');
  }
};

main().catch((error: Error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
