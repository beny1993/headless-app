/**
 * One-off live check of the SMS.ir driver against the REAL provider.
 *
 *   pnpm verify-sms 09121234567
 *
 * It dispatches one throwaway code through the same `sendOtpSms` the login
 * endpoint calls, so a pass proves the whole chain: the key is accepted, the
 * template id exists, the `#OTP#` parameter substitutes, and the number is
 * reachable. The mocked unit tests cannot check any of that.
 *
 * NOT part of `pnpm test` — it needs real credentials and sends a real message.
 * Requires, in `.env`: APP_CONFIG_SMSIR_API_KEY and APP_CONFIG_SMSIR_TEMPLATE_ID.
 * It forces the `smsir` driver regardless of APP_CONFIG_SMS_PROVIDER, so the
 * console default stays the local login path and this stays an explicit act.
 * If the SMS.ir panel's IP restriction is on, this machine's IP must be listed.
 */
import './load-env';
import { randomInt } from 'node:crypto';
import { normalizeIranPhone } from '@/lib/auth/phone';
import { sendOtpSms } from '@/lib/sms';
import { getEnvVariable, VARS } from '@/lib/utils/env';

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

  const code = String(randomInt(100000, 1000000));
  await sendOtpSms(phone, code);

  console.log(`\n✓ SMS.ir accepted the send (code ${code}).`);
  console.log('  Check the handset: it should arrive within a minute.');
};

main().catch((error: Error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
