import {
  accountOrderPath,
  apiOrderReceiptsPath,
  checkoutResultPath,
} from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import type { Locator, Page } from '@playwright/test';
import { z } from 'zod';
import {
  ADMIN_STATE,
  attachReceipt,
  closeIfStillWaiting,
  CUSTOMER_STATE,
  expect,
  expectFailedRequest,
  expectRendered,
  IN_STOCK_PRODUCT,
  lineCount,
  LOW_STOCK_PRODUCT,
  placeOrder,
  reachPayment,
  resultOrderId,
  test,
} from './support';

test.use({ storageState: CUSTOMER_STATE });

// The card-to-card order a test placed, closed after it if it is still waiting
// for its receipt — as it would be had its screenshot failed to store — and so
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

/**
 * The order summary's one line shows its product's photo: an `alt=""` image
 * (the title follows it), which the receipt's numbered thumbnail is not.
 */
async function expectLinePhoto(page: Page) {
  const photo = page.locator('main li img[alt=""]');
  await expect(photo).toHaveCount(1);
  await photo.scrollIntoViewIfNeeded();
  await expectRendered(photo);
}

/**
 * An order whose receipt is in shows just that receipt: no second upload box,
 * and no card numbers left to pay to. The panel is found by its fixed contact
 * sentence, never by its note, which the admin writes.
 */
async function expectOnlyTheReceipt(
  page: Page,
  prefix: 'checkout-result' | 'account-order',
) {
  await expect(
    page.locator(`[data-umami-event="${prefix}-receipt-file"]`),
  ).toHaveCount(0);
  await expect(
    page.locator(`[data-umami-event="${prefix}-receipt-upload"]`),
  ).toHaveCount(0);
  await expect(
    page.getByText('برای هماهنگی، از طریق', { exact: false }),
  ).toHaveCount(0);
}

test('card to card: the screenshot attached at checkout accepts the order, and only its owner can read it', async ({
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
  await reachPayment(page);
  await page.locator('[data-umami-event="checkout-payment-cod"]').check();

  // «ثبت سفارش» stays locked until the transfer's screenshot is attached. The
  // picker's label is a thumb's height, 44px: the input itself is sr-only.
  const submit = page.locator('[data-umami-event="checkout-submit-order"]');
  await expect(submit).toBeDisabled();
  const picker = page.locator('label', {
    has: page.locator('[data-umami-event="checkout-receipt-file"]'),
  });
  expect((await picker.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await attachReceipt(page);
  await expect(submit).toBeEnabled();
  // The picked file is never named — a phone names a screenshot with its
  // timestamp — so the checkout page shows no ASCII digit either.
  await expect(page.getByRole('main')).not.toContainText(/\d/);

  await submit.click();
  const orderId = await resultOrderId(page);
  placedOrder = orderId;

  // Placed and accepted in that one click: no waiting page on this path.
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();
  const status = page.getByText('وضعیت سفارش', { exact: true }).locator('..');
  await expect(status).toContainText('در حال پردازش');
  await expect(
    page.getByText(
      'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.',
    ),
  ).toHaveCount(1); // the sub-copy under the heading; the box does not repeat it

  // The screenshot is listed with when it came: a date and a Tehran time,
  // since one order can hold five receipts from the same day.
  const receipt = page.locator(
    '[data-umami-event="checkout-result-receipt-open"]',
  );
  await expect(receipt).toHaveCount(1);
  await expectOnlyTheReceipt(page, 'checkout-result');
  // The ordered line shows its product's photo, not the placeholder.
  await expectLinePhoto(page);
  // Lazy-loaded, and below the fold on a phone: it loads once it is in view.
  await receipt.scrollIntoViewIfNeeded();
  await expectRendered(receipt.locator('img'));
  await expect(receipt.locator('..')).toContainText(
    /۱۴[۰-۹]{2} ساعت [۰-۹]{2}:[۰-۹]{2}/,
  );

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
  await listed.click();
  await expect(
    page.locator('[data-umami-event="account-order-receipt-open"]'),
  ).toHaveCount(1);
  await expectOnlyTheReceipt(page, 'account-order');
  await expectLinePhoto(page);
});

test('card to card: a screenshot that fails to store is sent again from the checkout, to the same order', async ({
  page,
}) => {
  // The first upload is cut, as a dropped connection would cut it; the
  // shopper presses «ارسال دوباره رسید» and the same order is accepted.
  const receiptUpload = '**/api/orders/*/receipts';
  let cut = false;
  await page.route(receiptUpload, (route) => {
    if (cut) return route.continue();
    cut = true;
    return route.abort();
  });
  await placeOrder(page, 'cod');

  const button = page.locator('[data-umami-event="checkout-submit-order"]');
  await expect(
    page.getByText('بارگذاری رسید ناموفق بود. دوباره تلاش کن.'),
  ).toBeVisible();
  await expect(button).toHaveText('ارسال دوباره رسید');
  await expect(
    page.locator('[data-umami-event="checkout-payment-cod"]'),
  ).toBeDisabled();
  await button.click();

  placedOrder = await resultOrderId(page);
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();
  await expect(
    page.locator('[data-umami-event="checkout-result-receipt-open"]'),
  ).toHaveCount(1);
});

test('card to card: a reload keeps the waiting order’s retry, and its screenshot then accepts it', async ({
  page,
}) => {
  // The upload is cut and the page reloaded: the retry that held the order
  // went with the page, so /checkout picks the order back up from the server.
  const receiptUpload = '**/api/orders/*/receipts';
  await page.route(receiptUpload, (route) => route.abort());
  await placeOrder(page, 'cod');
  const button = page.locator('[data-umami-event="checkout-submit-order"]');
  await expect(button).toHaveText('ارسال دوباره رسید');
  await page.unroute(receiptUpload);

  await page.reload();
  await page.waitForURL(/\/checkout\?resume=/);
  await expect(button).toHaveText('ارسال دوباره رسید');
  await expect(button).toBeDisabled();
  await attachReceipt(page);
  await button.click();

  placedOrder = await resultOrderId(page);
  await expect(
    page.getByRole('heading', { name: 'سفارش ثبت شد!' }),
  ).toBeVisible();
  // Back skips the retry: the order it held is accepted now.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/checkout/);
});

test('card to card: the shopper cancels a waiting order from their account, its stock comes back, and the retry left open leads to it', async ({
  page,
}) => {
  const { path, stock } = LOW_STOCK_PRODUCT;
  const stockLeft = (count: number) =>
    page.getByText(`تنها ${formatNumber(count)} عدد باقی مانده`);

  // The screenshot never arrives: the order waits, open, for its receipt.
  const receiptUpload = '**/api/orders/*/receipts';
  await page.route(receiptUpload, (route) => route.abort());
  await placeOrder(page, 'cod', path);
  const orderId = z
    .uuid()
    .parse(
      (
        await page
          .locator('[data-umami-event="checkout-receipt-view-order"]')
          .getAttribute('href')
      )?.slice(checkoutResultPath('').length),
    );
  placedOrder = orderId;
  await page.unroute(receiptUpload);

  // Cancelled from the account in another tab, the retry still open here.
  const account = await page.context().newPage();
  await account.goto(accountOrderPath(orderId));
  await account.locator('[data-umami-event="account-order-cancel"]').click();
  // The question reads as a sentence at both widths, never squeezed into a
  // column beside its buttons, as it was at 375px.
  await expect
    .poll(() => lineCount(account.getByText('این سفارش لغو شود؟')))
    .toBeLessThanOrEqual(2);
  await account
    .locator('[data-umami-event="account-order-cancel-confirm"]')
    .click();

  await expect(account.getByText('این سفارش لغو شد.')).toBeVisible();
  await expect(
    account.getByText('دلیل: به درخواست خریدار لغو شد.', { exact: false }),
  ).toBeVisible();
  // Cancelled is final: nothing left to cancel.
  await expect(
    account.locator('[data-umami-event="account-order-cancel"]'),
  ).toHaveCount(0);
  await account.close();

  // The retry can only be refused now: it leaves for the order's page, which
  // says why.
  expectFailedRequest(
    page,
    new RegExp(`^409 .*${apiOrderReceiptsPath(orderId)}$`),
  );
  await attachReceipt(page);
  await page.locator('[data-umami-event="checkout-submit-order"]').click();
  await page.waitForURL((url) => url.pathname === checkoutResultPath(orderId));
  await expect(
    page.getByRole('heading', { name: 'سفارش لغو شد' }),
  ).toBeVisible();

  await page.goto(path);
  await expect(stockLeft(stock)).toBeVisible();
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

  // The order's own page offers the same retry, under a banner whose title
  // stays on one line at both widths: at 375px it once wrapped a word a line
  // beside the button.
  const orderId = await resultOrderId(page);
  await page.goto(accountOrderPath(orderId));
  await expect(
    page.locator('[data-umami-event="checkout-result-retry-pay"]'),
  ).toBeVisible();
  await expect
    .poll(() => lineCount(page.getByText('این سفارش هنوز پرداخت نشده است')))
    .toBe(1);
  await page.goto(checkoutResultPath(orderId));

  await page.locator('[data-umami-event="checkout-result-retry-pay"]').click();
  await page.locator(gatewayButton('pay')).click();
  await expect(
    page.getByRole('heading', { name: 'پرداخت موفق بود!' }),
  ).toBeVisible();
});
