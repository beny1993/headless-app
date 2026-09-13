import { expect, test } from '@playwright/test';
import { CUSTOMER_STATE, placeOrder } from './support';

test.use({ storageState: CUSTOMER_STATE });

test('cash on delivery: the order is confirmed and listed in the account', async ({
  page,
}) => {
  await placeOrder(page, 'cod');
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();

  // `#۱۲۳`, the number a shopper would quote to support.
  const orderNo = await page.getByText(/^#[۰-۹]+$/).innerText();
  await page.locator('[data-umami-event="checkout-result-my-orders"]').click();
  await expect(
    page.locator('[data-umami-event="account-order-open"]', {
      hasText: `سفارش ${orderNo}`,
    }),
  ).toBeVisible();
});

test('Zarinpal: paying at the mock gateway settles the order', async ({
  page,
}) => {
  await placeOrder(page, 'zarinpal');
  await page.getByRole('button', { name: 'پرداخت موفق' }).click();
  await expect(
    page.getByRole('heading', { name: 'پرداخت موفق بود!' }),
  ).toBeVisible();
});

test('Zarinpal: a failed payment keeps the order open for a retry', async ({
  page,
}) => {
  await placeOrder(page, 'zarinpal');
  await page.getByRole('button', { name: 'لغو / پرداخت ناموفق' }).click();
  // The attempt failed, not the order: it waits at pending_payment until the
  // shopper retries or the reconcile sweep expires it.
  await expect(
    page.getByRole('heading', { name: 'در انتظار تایید پرداخت' }),
  ).toBeVisible();
  await expect(
    page.locator('[data-umami-event="checkout-result-retry-pay"]'),
  ).toBeVisible();
});
