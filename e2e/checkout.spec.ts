import { accountOrderPath } from '@/lib/constant/paths';
import type { Locator } from '@playwright/test';
import {
  ADMIN_STATE,
  closeIfStillWaiting,
  completeCheckout,
  CUSTOMER_STATE,
  expect,
  expectRendered,
  IN_STOCK_PRODUCT,
  placeOrder,
  resultOrderId,
  test,
  uploadReceipt,
} from './support';

test.use({ storageState: CUSTOMER_STATE });

// The card-to-card order a test placed, closed after it if it is still waiting
// for its receipt — as it would be had the test failed before its upload, and
// open against the customer's cap. Through an admin context of its own: this
// file's pages are the customer's.
let placedOrder: string | undefined;
test.afterEach(async ({ browser, baseURL }) => {
  if (!placedOrder) return;
  const admin = await browser.newContext({
    baseURL,
    storageState: ADMIN_STATE,
  });
  try {
    await closeIfStillWaiting(admin.request, placedOrder);
  } finally {
    placedOrder = undefined;
    await admin.close();
  }
});

/** A product photo served by `/_next/image`, and decoded. */
async function expectOptimized(img: Locator) {
  await expect(img).toHaveAttribute('src', /^\/_next\/image\?/);
  await expectRendered(img);
}

/** The mock gateway's own buttons, by the action they post, not their copy. */
const gatewayButton = (action: 'pay' | 'fail') =>
  `button[name="action"][value="${action}"]`;

test('card to card: the receipt accepts the order, and only its owner can read it', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto(IN_STOCK_PRODUCT);
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  // The drawer and the summary show the photo through the image optimizer,
  // never the bucket URL: production's bucket 404s a browser loading it.
  await expectOptimized(
    page.getByRole('dialog', { name: 'سبد خرید' }).locator('img'),
  );
  await page.locator('[data-umami-event="cart-checkout-click"]').click();
  await expectOptimized(
    page
      .getByRole('heading', { name: 'خلاصه سفارش' })
      .locator('..')
      .locator('img'),
  );

  // A new account's recipient name starts blank, never as its phone number;
  // the phone itself is prefilled.
  await expect(
    page.locator('[data-umami-event="checkout-recipient-name"]'),
  ).toHaveValue('');
  await expect(
    page.locator('[data-umami-event="checkout-recipient-phone"]'),
  ).toHaveValue(/^09\d{9}$/);
  await completeCheckout(page, 'cod');
  const orderId = await resultOrderId(page);
  placedOrder = orderId;
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();

  // Placed, not yet accepted: it waits for the shopper's receipt.
  const status = page.getByText('وضعیت سفارش', { exact: true }).locator('..');
  await expect(status).toContainText('در انتظار رسید واریز');
  await expect(
    page.getByText(
      'هنوز رسیدی دریافت نشده است. پس از واریز، رسید را همین‌جا بارگذاری کن.',
    ),
  ).toBeVisible();

  // The first receipt accepts it, and says when it came: a date and a Tehran
  // time, since one order can hold five receipts from the same day.
  const receipt = await uploadReceipt(page);
  await expect(status).toContainText('در حال پردازش');
  await expect(receipt.locator('..')).toContainText(
    /۱۴[۰-۹]{2} ساعت [۰-۹]{2}:[۰-۹]{2}/,
  );
  await expect(
    page.getByText(
      'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.',
    ),
  ).toHaveCount(2); // the sub-copy under the heading, and the box's own line

  // Dates render in the Jalali calendar and every number goes through
  // src/lib/format.ts: a Gregorian year or an ASCII digit skipped them —
  // the receipt's upload time and the box's size hint included.
  await expect(page.getByText('تاریخ ثبت').locator('..')).toContainText(
    /۱۴[۰-۹]{2}/,
  );
  await expect(page.getByRole('main')).not.toContainText(/\d/);

  // The receipt is readable in the shopper's own session, and nowhere else:
  // uncacheable, and a 401 to anyone without a session. Fetched, never an
  // <img>, so the answer is the route's and not a cache's.
  const receiptUrl = await receipt.getAttribute('href');
  if (!receiptUrl) throw new Error('the receipt thumbnail links nowhere');
  const owned = await page.request.get(receiptUrl);
  expect(owned.status()).toBe(200);
  expect(owned.headers()['cache-control']).toBe('private, no-store');
  expect(owned.headers()['content-type']).toBe('image/jpeg');
  // An explicitly empty state: a context made in a test inherits the file's
  // `storageState`, which is the customer's session.
  const stranger = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    expect((await stranger.request.get(receiptUrl)).status()).toBe(401);
  } finally {
    await stranger.close();
  }

  await page.locator('[data-umami-event="checkout-result-my-orders"]').click();
  const listed = page.locator(
    `[data-umami-event="account-order-open"][href="${accountOrderPath(orderId)}"]`,
  );
  await expect(listed).toBeVisible();
  await expect(listed).toContainText('در حال پردازش');
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
