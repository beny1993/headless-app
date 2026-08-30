import { DEFAULT_SITE_NAME } from '@/constants';
import { UserDao } from '@/db/dao/UserDao';
import { OtpEmail } from '@/emails/auth/otp';
import sendEmail from '@/lib/email';
import { AUTH_PATHS } from '@/lib/constant/paths';
import { getAppBaseUrl, isDevelopmentServer } from '@/lib/utils/env';

export type OtpRequest = {
  email: string;
  otp: string;
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
};

export async function handleOtpRequest({
  email,
  otp,
  type,
}: OtpRequest): Promise<void> {
  if (type !== 'sign-in') return;

  const normalizedEmail = email.toLowerCase();

  // Invite-only gate (in addition to the plugin's `disableSignUp`): only
  // provisioned users receive a code. Silently ignore unknown emails so the
  // endpoint doesn't reveal which addresses exist.
  const user = await UserDao.findByEmail(normalizedEmail);
  if (!user) {
    console.warn(
      `[auth] OTP requested for unknown email ${normalizedEmail} — ignored`,
    );
    return;
  }

  const host = getAppBaseUrl();
  // Encode so `+`-aliased emails survive the magic-link round-trip
  // (else `+` decodes to space).
  const magicUrl = `${host}${AUTH_PATHS.MAGIC}?email=${encodeURIComponent(normalizedEmail)}&otp=${encodeURIComponent(otp)}`;

  // In development the code is logged instead of emailed — no SMTP needed.
  if (isDevelopmentServer()) {
    console.log('[auth] sign-in OTP (dev)', {
      email: normalizedEmail,
      otp,
      magicUrl,
    });
    return;
  }

  await sendEmail({
    component: OtpEmail({ otp, magicUrl }),
    subject: `Your ${DEFAULT_SITE_NAME} sign-in code`,
    to: normalizedEmail,
  });
}
