import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import {
  PATHS,
  PROTECTED_PATHS,
  adminContentAreaPath,
} from '@/lib/constant/paths';
import { formatToman, toAsciiDigits } from '@/lib/format';
import { ADMIN_STATE, expect, openCheckout, test } from './support';

test.use({ storageState: ADMIN_STATE });

// Both change settings the whole dev database shares, so each puts the old
// value back in a `finally`, even when an assertion fails.

test('a shipping rate an admin changes is what checkout charges', async ({
  page,
  shopper,
}) => {
  // The last seeded province: no other spec delivers there.
  const province = SEED_PROVINCES[SEED_PROVINCES.length - 1].name;

  await page.goto(PROTECTED_PATHS.SHIPPING);
  const fee = page.getByLabel(`هزینه ارسال ${province}`, { exact: true });
  const row = page.locator('tr', { has: fee });
  const original = await fee.inputValue();
  const changed = Number(toAsciiDigits(original)) + 1_000;

  const saveFee = async (value: string) => {
    // Save stays disabled on an unchanged value: restoring after a save that
    // never took would otherwise wait out the test and bury the real failure.
    if ((await fee.inputValue()) === value) return;
    await fee.fill(value);
    await row.locator('[data-umami-event="admin-panel-shipping-save"]').click();
    await expect(row.getByText('ذخیره شد')).toBeVisible();
  };

  await saveFee(String(changed));
  try {
    await openCheckout(shopper);
    await shopper.locator('[data-umami-event="checkout-step-next"]').click();
    await shopper
      .locator('[data-umami-event="checkout-province-change"]')
      .selectOption({ label: province });
    await expect(shopper.getByText(formatToman(changed)).first()).toBeVisible();
  } finally {
    await saveFee(original);
  }
});

test('a headline an admin edits is what the home page shows', async ({
  page,
  shopper,
}) => {
  await page.goto(adminContentAreaPath('home'));
  const hero = page.locator('form', {
    has: page.getByRole('heading', { name: 'بخش قهرمان' }),
  });
  const headline = hero.getByLabel('سرتیتر', { exact: true });
  const original = await headline.inputValue();
  const edited = `تیتر آزمایشی ${Date.now().toString(36)}`;

  const saveHeadline = async (text: string) => {
    await headline.fill(text);
    await hero.locator('[data-umami-event="admin-panel-content-save"]').click();
    await expect(hero.getByText('ذخیره شد')).toBeVisible();
  };

  await saveHeadline(edited);
  try {
    await shopper.goto(PATHS.HOME);
    await expect(shopper.getByRole('heading', { level: 1 })).toContainText(
      edited,
    );
  } finally {
    await saveHeadline(original);
  }
});
