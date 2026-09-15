import { accountOrderPath } from '@/lib/constant/paths';
import {
  CUSTOMER_STATE,
  expect,
  placeOrder,
  resultOrderId,
  test,
} from './support';

test.use({ storageState: CUSTOMER_STATE });

/** The mock gateway's own buttons, by the action they post, not their copy. */
const gatewayButton = (action: 'pay' | 'fail') =>
  `button[name="action"][value="${action}"]`;

test('card to card: the order is confirmed and listed in the account', async ({
  page,
}) => {
  await placeOrder(page, 'cod');
  const orderId = await resultOrderId(page);
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();

  // Dates render in the Jalali calendar and every number goes through
  // src/lib/format.ts: a Gregorian year or an ASCII digit skipped them.
  await expect(page.getByText('تاریخ ثبت').locator('..')).toContainText(
    /۱۴[۰-۹]{2}/,
  );
  await expect(page.getByRole('main')).not.toContainText(/\d/);

  await page.locator('[data-umami-event="checkout-result-my-orders"]').click();
  await expect(
    page.locator(
      `[data-umami-event="account-order-open"][href="${accountOrderPath(orderId)}"]`,
    ),
  ).toBeVisible();
});

test('Zarinpal: paying at the mock gateway settles the order', async ({
  page,
}) => {
  await placeOrder(page, 'zarinpal');
  await page.locator(gatewayButton('pay')).click();
  await expect(
    page.getByRole('heading', { name: 'پرداخت موفق بود!' }),
  ).toBeVisible();
});

test('Zarinpal: a failed payment can be retried and paid', async ({ page }) => {
  await placeOrder(page, 'zarinpal');
  await page.locator(gatewayButton('fail')).click();
  // The attempt failed, not the order: it waits at pending_payment for a retry.
  await expect(
    page.getByRole('heading', { name: 'در انتظار تایید پرداخت' }),
  ).toBeVisible();

  await page.locator('[data-umami-event="checkout-result-retry-pay"]').click();
  await page.locator(gatewayButton('pay')).click();
  await expect(
    page.getByRole('heading', { name: 'پرداخت موفق بود!' }),
  ).toBeVisible();
});
