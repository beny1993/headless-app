import { render } from '@react-email/components';
import nodemailer from 'nodemailer';
import * as Sentry from '@sentry/nextjs';
import { ReactElement } from 'react';
import { DEFAULT_SITE_NAME, DEFAULT_SUPPORT_EMAIL } from '@/constants';
import { getEnvVariable, VARS } from '../utils/env';

export type SendEmailParams = {
  component: ReactElement;
  subject: string;
  to: string;
  cc?: string[];
  attachments?: nodemailer.SendMailOptions['attachments'];
};

export default async function sendEmail({
  component,
  subject,
  to,
  cc,
  attachments,
}: SendEmailParams) {
  const html = await render(component);
  const text = await render(component, { plainText: true });

  // With APP_CONFIG_EMAIL_ENABLED unset/false, emails are logged instead of
  // sent — local development needs no SMTP account.
  const emailEnabled =
    getEnvVariable(VARS.APP_CONFIG_EMAIL_ENABLED, false, 'false') === 'true';
  if (!emailEnabled) {
    console.log(`[email:disabled] Would send "${subject}" to ${to}`, {
      cc,
      text,
    });
    return;
  }

  const senderEmail = getEnvVariable(VARS.APP_CONFIG_SMTP_SENDER_EMAIL, true);
  const port = parseInt(getEnvVariable(VARS.APP_CONFIG_SMTP_PORT, true));

  const emailBody: nodemailer.SendMailOptions = {
    from: `${DEFAULT_SITE_NAME} <${senderEmail}>`,
    to,
    subject,
    html,
    text,
    cc,
    attachments,
    replyTo: DEFAULT_SUPPORT_EMAIL,
    headers: {
      'List-Unsubscribe': `<mailto:${DEFAULT_SUPPORT_EMAIL}?subject=unsubscribe>`,
      'X-Mailer': DEFAULT_SITE_NAME,
    },
  };

  try {
    const transporter = nodemailer.createTransport({
      host: getEnvVariable(VARS.APP_CONFIG_SMTP_SERVER, true),
      port,
      secure: port === 465, // true for 465, false for other ports like 587
      auth: {
        user: getEnvVariable(VARS.APP_CONFIG_SMTP_USER, true),
        pass: getEnvVariable(VARS.APP_CONFIG_SMTP_PASSWORD, true),
      },
      ...(port !== 465 && {
        tls: {
          rejectUnauthorized: true,
        },
      }),
    });
    await transporter.sendMail(emailBody);
    console.log(`[email] Sent "${subject}" to ${to}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[email] Failed to send "${subject}" to ${to}: ${message}`);
    // `subject` only — the recipient address stays in the container log. It is
    // the customer's email, and nothing here needs it to identify the fault.
    Sentry.captureException(error, { extra: { subject } });
    throw new Error(message);
  }
}
