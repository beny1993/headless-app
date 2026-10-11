// Courier delivery at checkout ([[Story - Courier Delivery at Checkout]]):
// «ارسال با پیک» is offered for a Tehran address and not elsewhere, adds no
// shipping fee, and the order it places says so to the shopper and the admin.
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { adminOrderPath } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import {
  COURIER_FEE_TEXT,
  COURIER_TEHRAN_ONLY,
} from '@/lib/orders/delivery-method';
import {
  ADMIN_STATE,
  attachReceipt,
  closeOrder,
  CUSTOMER_STATE,
  expect,
  openCheckout,
  reachPayment,
  resultOrderId,
  test,
} from './support';

test.use({ storageState: CUSTOMER_STATE });

const TEHRAN = SEED_PROVINCES[0];
const ELSEWHERE = SEED_PROVINCES[1];

test('courier: a Tehran order goes by courier with no shipping fee, and the admin sees it', async ({
  page,
  browser,
  baseURL,
}) => {
  expect(TEHRAN.name).toBe('تهران');
  await openCheckout(page);
  await reachPayment(page); // delivers to the first seeded province, Tehran

  const post = page.locator('[data-umami-event="checkout-delivery-post"]');
  const courier = page.locator(
    '[data-umami-event="checkout-delivery-courier"]',
  );
  const summary = page
    .getByRole('heading', { name: 'خلاصه سفارش' })
    .locator('..');

  // Post is the default, with the province's fee.
  await expect(post).toBeChecked();
  await expect(courier).toBeEnabled();
  await expect(summary).toContainText(formatToman(TEHRAN.fee));

  await courier.check();
  await expect(summary).toContainText('ارسال با پیک');
  await expect(summary).toContainText(COURIER_FEE_TEXT);
  // No fee anywhere in the sum: the shipping row is the courier's text, so
  // the total is the items' («جمع اقلام» and «جمع کل» read the same).
  await expect(summary.locator('dd').last()).toHaveText(
    (await summary.locator('dd').first().textContent()) ?? '',
  );

  // Elsewhere, the courier option is off and says why; back in Tehran it is
  // offered again, and the shopper picks it.
  await page.locator('[data-umami-event="checkout-step-back"]').click();
  await page
    .locator('[data-umami-event="checkout-province-change"]')
    .selectOption({ label: ELSEWHERE.name });
  await page.locator('[data-umami-event="checkout-step-next"]').click();
  await expect(courier).toBeDisabled();
  await expect(post).toBeChecked();
  await expect(page.getByText(COURIER_TEHRAN_ONLY)).toBeVisible();
  await expect(summary).toContainText(formatToman(ELSEWHERE.fee));

  await page.locator('[data-umami-event="checkout-step-back"]').click();
  await page
    .locator('[data-umami-event="checkout-province-change"]')
    .selectOption({ label: TEHRAN.name });
  await page.locator('[data-umami-event="checkout-step-next"]').click();
  await courier.check();

  await page.locator('[data-umami-event="checkout-payment-cod"]').check();
  await attachReceipt(page);
  await page.locator('[data-umami-event="checkout-submit-order"]').click();
  const orderId = await resultOrderId(page);

  const admin = await browser.newContext({
    baseURL,
    storageState: ADMIN_STATE,
  });
  const adminPage = await admin.newPage();
  try {
    // The shopper's result page names the courier, and no fee.
    await expect(
      page.getByText('روش ارسال', { exact: true }).locator('..'),
    ).toContainText('ارسال با پیک');
    await expect(page.getByRole('main')).toContainText(COURIER_FEE_TEXT);

    // The admin's order page says courier, on the address and the totals.
    await adminPage.goto(adminOrderPath(orderId));
    await expect(
      adminPage.getByRole('heading', { name: 'آدرس تحویل' }).locator('..'),
    ).toContainText('ارسال با پیک');
    await expect(adminPage.getByRole('main')).toContainText(COURIER_FEE_TEXT);
  } finally {
    await closeOrder(adminPage, orderId);
    await admin.close();
  }
});
