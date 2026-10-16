// Courier delivery at checkout ([[Story - Courier Delivery at Checkout]]):
// «ارسال با پیک» is offered for a Tehran address and not elsewhere, adds no
// shipping fee, and the order it places says so to the shopper and the admin.
//
// The same order carries the shopper's note («توضیحات سفارش»): typed on the
// checkout's last step, read back on both of the shopper's order pages and
// the admin's. Folded in here rather than given an order of its own — each
// run's customer is near the per-account checkout cap (`e2e/README.md`).
import type { Locator } from '@playwright/test';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { accountOrderPath, adminOrderPath } from '@/lib/constant/paths';
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
/**
 * The note as stored: trimmed, its line break kept. `toHaveText` folds
 * whitespace, so it would pass with the two lines run together; the raw
 * text does not.
 */
const expectNote = async (note: Locator) => {
  await expect(note).toBeVisible();
  expect(await note.textContent()).toBe(NOTE_LINES.join('\n'));
};
const NOTE_LINES = [
  'لطفاً یک روز دیرتر ارسال شود.',
  'اگر شد رنگ آبی را بفرستید.',
];

test('courier: a Tehran order goes by courier with no shipping fee, and the admin sees it and its note', async ({
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

  // The shopper's note, on two lines, with spaces the form trims.
  await page
    .locator('[data-umami-event="checkout-customer-note"]')
    .fill(`  ${NOTE_LINES.join('\n')}  `);

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
    const note = (on: typeof page) =>
      on.getByText(NOTE_LINES[0], { exact: false });
    // Its note, trimmed, both lines kept.
    await expectNote(note(page));

    // And on their account's order page.
    await page.goto(accountOrderPath(orderId));
    await expect(
      page.getByRole('heading', { name: 'توضیحات سفارش' }),
    ).toBeVisible();
    await expectNote(note(page));

    // The admin's order page says courier, on the address and the totals.
    await adminPage.goto(adminOrderPath(orderId));
    await expect(
      adminPage.getByRole('heading', { name: 'آدرس تحویل' }).locator('..'),
    ).toContainText('ارسال با پیک');
    await expect(adminPage.getByRole('main')).toContainText(COURIER_FEE_TEXT);
    await expect(
      adminPage.getByRole('heading', { name: 'توضیحات سفارش' }).locator('..'),
    ).toContainText(NOTE_LINES[1]);
    await expectNote(note(adminPage));
  } finally {
    await closeOrder(adminPage, orderId);
    await admin.close();
  }
});
