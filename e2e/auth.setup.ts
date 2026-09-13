import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { expect, test as setup, type Page } from '@playwright/test';
import { ADMIN_STATE, CUSTOMER_STATE } from './support';

/**
 * A number nobody has used yet. Each run signs in new accounts, so the 90s
 * per-phone resend cooldown and the hourly per-phone cap never carry over from
 * the last run.
 */
const freshPhone = () =>
  `0999${randomInt(10_000_000).toString().padStart(7, '0')}`;

const requestCode = async (page: Page) => {
  const [response] = await Promise.all([
    page.waitForResponse('**/api/auth/phone-number/send-otp'),
    page.locator('[data-umami-event="login-request-code"]').click(),
  ]);
  return response;
};

/**
 * Signs `phone` in through the real login screen and lands on `next`. The code
 * is read off the page, where the console SMS driver's staging echo shows it.
 */
async function signIn(page: Page, phone: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('[data-umami-event="login-phone-type"]').fill(phone);

  // send-otp allows 3 a minute, and Better Auth files every request from this
  // machine under one client when it cannot resolve an IP. A run started
  // within a minute of the last one waits the window out instead of failing.
  let response = await requestCode(page);
  for (let retry = 0; response.status() === 429 && retry < 2; retry++) {
    const seconds = Number(response.headers()['x-retry-after']) || 60;
    await page.waitForTimeout((seconds + 1) * 1000);
    response = await requestCode(page);
  }
  expect(response.status(), 'send-otp').toBe(200);

  const devCode = page.getByText('حالت آزمایشی').locator('span');
  await expect(
    devCode,
    'the login page shows no code: the server needs APP_CONFIG_SMS_PROVIDER=console and APP_CONFIG_SHOW_OTP_IN_UI=true',
  ).toHaveText(/^\d{6}$/);

  // Typed, not filled: each box holds one digit (`maxLength`), which `fill`
  // respects, and typing is the path where the form walks focus along the
  // boxes. It verifies on its own once the sixth digit lands.
  const code = (await devCode.textContent()) ?? '';
  await page
    .locator('[data-umami-event="login-code-type"]')
    .first()
    .pressSequentially(code);
  await page.waitForURL(`**${next}`);
}

setup('a new customer signs in with a phone OTP', async ({ page }) => {
  setup.setTimeout(3 * 60_000);
  await signIn(page, freshPhone(), '/account');
  await page.context().storageState({ path: CUSTOMER_STATE });
});

setup('an admin signs in with a phone OTP', async ({ page }) => {
  setup.setTimeout(3 * 60_000);
  const phone = freshPhone();
  // The one way a role is granted; the process env already carries the
  // database URL the config loaded.
  execFileSync('pnpm', ['create-admin', phone], { stdio: 'inherit' });
  await signIn(page, phone, '/admin-panel');
  await page.context().storageState({ path: ADMIN_STATE });
});
