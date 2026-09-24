import type { Page } from '@playwright/test';
import { z } from 'zod';
import { API_PATHS, PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';
import {
  ADMIN_STATE,
  apiCall,
  expect,
  expectFailedRequest,
  openCheckout,
  runId,
  test,
} from './support';

test.use({ storageState: ADMIN_STATE });

// Provinces only switch off, never delete: one row per run, at one width, and
// switched off again in a `finally` so no later checkout ever offers it. Seeded
// provinces are never touched — other suites count on all of them being active.
test.skip(({ isMobile }) => isMobile, 'creates a row that is never deleted');

const provinceCall = (method: string) =>
  apiCall(method, API_PATHS.ADMIN_PROVINCES);

const publicRatesSchema = z.object({
  data: z.array(z.object({ name: z.string() })),
});

/** The province names the public rate list gives a shopper. */
const publicProvinceNames = async (page: Page) =>
  publicRatesSchema
    .parse(await (await page.request.get(API_PATHS.SHIPPING_RATES)).json())
    .data.map((rate) => rate.name);

test('a province an admin adds is offered at checkout until it is switched off', async ({
  page,
  shopper,
}) => {
  test.slow();
  // The two refused duplicates are the 409s this spec is here to see.
  expectFailedRequest(page, new RegExp(`^409 .*${API_PATHS.ADMIN_PROVINCES}$`));
  const name = `استان آزمایشی ${runId()}`;
  const fee = 31_415;
  const changed = fee + 1_000;

  // The table row, found by its own fee field's label.
  const feeInput = page.getByLabel(`هزینه ارسال ${name}`, { exact: true });
  const row = page.locator('tr', { has: feeInput });
  const badge = (status: 'فعال' | 'غیرفعال') =>
    row.getByText(status, { exact: true });

  /** Adds `name` through the create form; returns the API's answer. */
  const addProvince = async () => {
    await page
      .locator('[data-umami-event="admin-panel-shipping-province-name"]')
      .fill(name);
    await page
      .locator('[data-umami-event="admin-panel-shipping-province-fee"]')
      .fill(String(fee));
    const [response] = await Promise.all([
      page.waitForResponse(provinceCall('POST')),
      page
        .locator('[data-umami-event="admin-panel-shipping-province-create"]')
        .click(),
    ]);
    return response;
  };

  /** A refused duplicate: a 409, its message as an error toast, no new row. */
  const refuseDuplicate = async () => {
    const refused = await addProvince();
    expect(refused.status()).toBe(409);
    const { message } = z
      .object({ message: z.string().min(1) })
      .parse(await refused.json());
    await expect(
      page
        .locator('[data-sonner-toast][data-type="error"]')
        .filter({ hasText: message }),
    ).toBeVisible();
    await expect(row).toHaveCount(1);
    return message;
  };

  const setActive = async (active: boolean) => {
    const from = active ? 'غیرفعال' : 'فعال';
    if ((await badge(from).count()) === 0) return;
    await Promise.all([
      page.waitForResponse(provinceCall('PATCH')),
      row
        .locator('[data-umami-event="admin-panel-shipping-province-toggle"]')
        .click(),
    ]);
    await expect(badge(active ? 'فعال' : 'غیرفعال')).toBeVisible();
  };

  // Checkout from a fresh load, with the address they saved picked — the cart
  // stays in localStorage between loads. Returns the delivery step's province
  // select: on the page while the province is off, since a saved address on an
  // active province skips that step for payment.
  const checkoutWithSavedAddress = async () => {
    await shopper.goto(PATHS.CHECKOUT);
    await shopper
      .locator('[data-umami-event="checkout-saved-address-select"]')
      .selectOption({ index: 1 });
    await shopper.locator('[data-umami-event="checkout-step-next"]').click();
    return shopper.locator('[data-umami-event="checkout-province-change"]');
  };

  await page.goto(PROTECTED_PATHS.SHIPPING);
  expect((await addProvince()).status()).toBe(201);
  await expect(badge('فعال')).toBeVisible();

  try {
    // Offered to a shopper: the account address form saves an address on it,
    // and checkout charges its fee.
    await shopper.goto(PATHS.ACCOUNT);
    await shopper.locator('[data-umami-event="account-tab-addresses"]').click();
    await shopper.locator('[data-umami-event="account-addresses-add"]').click();
    await shopper
      .locator('[data-umami-event="account-addresses-province"]')
      .selectOption({ label: name });
    await shopper
      .locator('[data-umami-event="account-addresses-recipient-name"]')
      .fill('گیرنده آزمایشی');
    await shopper
      .locator('[data-umami-event="account-addresses-recipient-phone"]')
      .fill('09121234567');
    await shopper
      .locator('[data-umami-event="account-addresses-city"]')
      .fill('شهر آزمایشی');
    await shopper
      .locator('[data-umami-event="account-addresses-postal"]')
      .fill('1234567890');
    await shopper
      .locator('[data-umami-event="account-addresses-line"]')
      .fill('خیابان آزادی، کوچه بهار، پلاک ۱۲');
    const [saved] = await Promise.all([
      shopper.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === API_PATHS.ME_ADDRESSES,
      ),
      shopper.locator('[data-umami-event="account-addresses-save"]').click(),
    ]);
    expect(saved.ok()).toBe(true);

    await openCheckout(shopper);
    await shopper
      .locator('[data-umami-event="checkout-saved-address-select"]')
      .selectOption({ index: 1 });
    await shopper.locator('[data-umami-event="checkout-step-next"]').click();
    // A saved address has nothing left to ask: the address step is skipped and
    // payment comes next, the province's fee already in the summary.
    await expect(
      shopper.locator('[data-umami-event="checkout-payment-cod"]'),
    ).toBeVisible();
    await expect(
      shopper.getByRole('heading', { name: 'آدرس تحویل' }),
    ).toHaveCount(0);
    await expect(shopper.getByText(formatToman(fee)).first()).toBeVisible();
    // Back lands on the first step, and «آدرس جدید» puts the address step back.
    await shopper.locator('[data-umami-event="checkout-step-back"]').click();
    await shopper
      .locator('[data-umami-event="checkout-saved-address-select"]')
      .selectOption({ index: 0 });
    await shopper.locator('[data-umami-event="checkout-step-next"]').click();
    await expect(
      shopper.getByRole('heading', { name: 'آدرس تحویل' }),
    ).toBeVisible();
    expect(await publicProvinceNames(shopper)).toContain(name);

    const activeDuplicate = await refuseDuplicate();

    // Switched off: it stays in the admin table, fee still editable.
    await setActive(false);
    await page.reload();
    await expect(badge('غیرفعال')).toBeVisible();
    await feeInput.fill(String(changed));
    await row.locator('[data-umami-event="admin-panel-shipping-save"]').click();
    await expect(row.getByText('ذخیره شد')).toBeVisible();

    // Re-adding it names the inactive row instead of reviving it.
    expect(await refuseDuplicate()).not.toBe(activeDuplicate);
    await expect(badge('غیرفعال')).toBeVisible();

    // Gone for the shopper: no option, no public listing, and the saved
    // address is flagged instead of carried on to payment.
    const province = await checkoutWithSavedAddress();
    await expect(shopper.getByText(STALE_PROVINCE_MESSAGE)).toBeVisible();
    await expect(province).toHaveValue('');
    await expect(
      province.getByRole('option', { name, exact: true }),
    ).toHaveCount(0);
    await shopper.locator('[data-umami-event="checkout-step-next"]').click();
    await expect(
      shopper.getByRole('heading', { name: 'آدرس تحویل' }),
    ).toBeVisible();
    await expect(
      shopper.locator('[data-umami-event="checkout-payment-cod"]'),
    ).toHaveCount(0);
    expect(await publicProvinceNames(shopper)).not.toContain(name);

    // The account address form flags it too, and will not save it.
    await shopper.goto(PATHS.ACCOUNT);
    await shopper.locator('[data-umami-event="account-tab-addresses"]').click();
    await shopper
      .locator('[data-umami-event="account-addresses-edit"]')
      .click();
    await expect(shopper.getByText(STALE_PROVINCE_MESSAGE)).toBeVisible();
    await shopper
      .locator('[data-umami-event="account-addresses-save"]')
      .click();
    await expect(shopper.getByText(STALE_PROVINCE_MESSAGE)).toBeVisible();
    await expect(
      shopper.locator('[data-umami-event="account-addresses-save"]'),
    ).toBeVisible();

    // Switched back on, at the fee set while it was off.
    await setActive(true);
    await checkoutWithSavedAddress();
    await expect(shopper.getByText(formatToman(changed)).first()).toBeVisible();
  } finally {
    await page.goto(PROTECTED_PATHS.SHIPPING);
    await setActive(false);
  }
});
