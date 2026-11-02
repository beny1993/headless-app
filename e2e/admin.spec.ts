import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';
import {
  adminProductFilterSchema,
  productsHref,
} from '@/features/admin-panel/products/products-query';
import type { Page } from '@playwright/test';
import {
  PATHS,
  PROTECTED_PATHS,
  accountOrderPath,
  adminOrderPath,
  checkoutResultPath,
} from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import {
  ADMIN_STATE,
  CUSTOMER_STATE,
  LOW_STOCK_PRODUCT,
  closeIfStillWaiting,
  closeOrder,
  expect,
  expectRendered,
  placeOrder,
  resultOrderId,
  test,
} from './support';

/**
 * How far the page, and its `main`, reach past their own width: both 0 when
 * nothing pushes the screen sideways. The admin panel's `main` scrolls on its
 * own (`overflow-y-auto`, so its x overflow is `auto` too), and a line too wide
 * for it widens `main`, not the page.
 */
const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('main');
    return {
      page: root.scrollWidth - root.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });

/**
 * A waiting order's page — its checkout screenshot never arrived — takes no
 * upload itself: no receipt box, no picker, no card numbers. It states the
 * wait and leads back to the checkout's retry with «ارسال رسید». The panel is
 * found by its fixed contact sentence, never by its note, which the admin
 * writes.
 */
async function expectNothingToUpload(page: Page) {
  await expect(
    page.getByText(
      'رسید واریز به ما نرسید. تا ۳۰ دقیقه پس از ثبت، تصویر رسید را بفرست؛ وگرنه سفارش لغو می‌شود.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ارسال رسید' })).toHaveAttribute(
    'href',
    /^\/checkout\?resume=/,
  );
  await expect(page.getByRole('heading', { name: 'رسید پرداخت' })).toHaveCount(
    0,
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByText('برای هماهنگی، از طریق', { exact: false }),
  ).toHaveCount(0);
}

/**
 * Cancels the order open on the admin's page: the cancel button asks for the
 * reason the shopper will read, and nothing is sent without one.
 */
async function cancelWithReason(page: Page, reason: string) {
  await page
    .locator('[data-umami-event="admin-panel-order-transition-cancelled"]')
    .click();
  await page
    .locator('[data-umami-event="admin-panel-order-cancel-reason"]')
    .fill(reason);
  await page
    .locator('[data-umami-event="admin-panel-order-cancel-submit"]')
    .click();
}

test('a signed-out visitor is sent to sign in first', async ({ page }) => {
  await page.goto(PROTECTED_PATHS.INDEX);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === PATHS.LOGIN &&
      url.searchParams.get('next') === PROTECTED_PATHS.INDEX,
  );
});

test.describe('a customer', () => {
  test.use({ storageState: CUSTOMER_STATE });

  // A session is not authorization: customers have sessions too.
  test('is turned away from the admin panel', async ({ page }) => {
    await page.goto(PROTECTED_PATHS.INDEX);
    await expect(page).toHaveURL((url) => url.pathname === PATHS.HOME);
  });
});

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  // Card-to-card orders a test means to move on — ship, cancel. One still
  // waiting for its receipt is open against the customer's cap — the cut
  // upload's, if its test fails before cancelling it — so each is closed after
  // the test, unless the test did move it on.
  const movedOn: string[] = [];
  test.afterEach(async ({ page }) => {
    for (const orderId of movedOn.splice(0)) {
      await closeIfStillWaiting(page.request, orderId);
    }
  });

  test('sees the dashboard figures, formatted', async ({ page }) => {
    await page.goto(PROTECTED_PATHS.INDEX);
    await expect(
      page.getByRole('heading', { level: 1, name: 'داشبورد' }),
    ).toBeVisible();
    // The figure on the revenue card went through src/lib/format.ts, or it
    // would carry ASCII digits.
    await expect(
      page.getByText('درآمد کل', { exact: true }).locator('..'),
    ).not.toContainText(/\d/);
  });

  test('finds a new order, sees its receipt and ships it', async ({
    page,
    shopper,
  }) => {
    // The order comes from a real checkout, in the customer's own session,
    // its screenshot attached there — the upload that accepts it.
    await placeOrder(shopper, 'cod');
    const orderId = await resultOrderId(shopper);
    movedOn.push(orderId);

    await page.goto(PROTECTED_PATHS.ORDERS);
    // Numbered from one down the first page, however many orders it holds.
    const rows = page.getByRole('row').filter({
      has: page.locator('[data-umami-event="admin-panel-orders-view"]'),
    });
    await expect(rows.first().getByRole('cell').first()).toHaveText(
      formatNumber(1),
    );
    await expect(rows.last().getByRole('cell').first()).toHaveText(
      formatNumber(await rows.count()),
    );

    await page
      .locator(
        `[data-umami-event="admin-panel-orders-view"][href="${adminOrderPath(orderId)}"]`,
      )
      .click();

    // Accepted by its receipt: in fulfilment, where shipping is the next move
    // — and delivery the only move after it. The receipt is on the page for
    // the admin to check first, served through the admin's own route.
    await expect(page).toHaveURL(
      (url) => url.pathname === adminOrderPath(orderId),
    );
    await expect(
      page.getByText('در حال پردازش', { exact: true }),
    ).toBeVisible();
    const receipt = page.locator(
      '[data-umami-event="admin-panel-order-receipt-open"]',
    );
    await expect(receipt).toHaveCount(1);
    await receipt.scrollIntoViewIfNeeded();
    await expectRendered(receipt.locator('img'));
    const ship = page.locator(
      '[data-umami-event="admin-panel-order-transition-shipped"]',
    );
    await ship.click();
    await expect(
      page.locator(
        '[data-umami-event="admin-panel-order-transition-delivered"]',
      ),
    ).toBeVisible();
    await expect(ship).toBeHidden();

    // Shipped, its receipt checked: the shopper reads the transfer as paid,
    // beside the receipt it approved.
    await shopper.goto(accountOrderPath(orderId));
    await expect(shopper.getByText('تأیید شد', { exact: true })).toBeVisible();
    await expect(
      shopper.getByText('پرداخت شده', { exact: true }),
    ).toBeVisible();
  });

  test('cancels an order still waiting for its receipt, and its stock comes back', async ({
    page,
    shopper,
  }) => {
    const { path, stock } = LOW_STOCK_PRODUCT;
    const stockLeft = (count: number) =>
      shopper.getByText(`تنها ${formatNumber(count)} عدد باقی مانده`);

    // The screenshot never reaches the shop: its upload is cut after the
    // order exists, as a dropped connection would cut it. Aborted, it gets no
    // response, so the failed-request watch (which reads responses) has
    // nothing to record.
    const receiptUpload = '**/api/orders/*/receipts';
    await shopper.route(receiptUpload, (route) => route.abort());
    await placeOrder(shopper, 'cod', path);
    // The checkout stays, says the screenshot did not go, and offers it again
    // to this order. The shopper leaves through the order's link instead.
    await expect(
      shopper.getByText('بارگذاری رسید ناموفق بود. دوباره تلاش کن.'),
    ).toBeVisible();
    await expect(
      shopper.locator('[data-umami-event="checkout-submit-order"]'),
    ).toHaveText('ارسال دوباره رسید');
    await shopper
      .locator('[data-umami-event="checkout-receipt-view-order"]')
      .click();
    const orderId = await resultOrderId(shopper);
    movedOn.push(orderId);
    await shopper.unroute(receiptUpload);

    // The result page says the order is not accepted yet, never the accepted
    // «سفارش ثبت شد!», and offers no second upload.
    await expect(
      shopper.getByRole('heading', { name: 'سفارش هنوز پذیرفته نشده است' }),
    ).toBeVisible();
    await expect(
      shopper.getByRole('heading', { name: 'سفارش ثبت شد!' }),
    ).toHaveCount(0);
    await expectNothingToUpload(shopper);
    // The account order page says so too.
    await shopper.goto(accountOrderPath(orderId));
    await expect(
      shopper.getByText('سفارش هنوز پذیرفته نشده است'),
    ).toBeVisible();
    await expectNothingToUpload(shopper);

    await shopper.goto(path);
    await expect(stockLeft(stock - 1)).toBeVisible();

    // No receipt ever came: the admin cancels the waiting order by hand.
    await page.goto(adminOrderPath(orderId));
    await expect(
      page.getByText('در انتظار رسید واریز', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('رسیدی در سایت بارگذاری نشده است.'),
    ).toBeVisible();
    await cancelWithReason(page, 'رسید پرداخت نرسید');
    // Cancelled is terminal: nothing is offered after it.
    await expect(
      page.locator(
        '[data-umami-event="admin-panel-order-transition-cancelled"]',
      ),
    ).toBeHidden();

    await shopper.goto(path);
    await expect(stockLeft(stock)).toBeVisible();
  });

  test('cancels an accepted order with a reason the shopper then reads', async ({
    page,
    shopper,
  }) => {
    const { path, stock } = LOW_STOCK_PRODUCT;
    const stockLeft = (count: number) =>
      shopper.getByText(`تنها ${formatNumber(count)} عدد باقی مانده`);
    // A pasted link: one unbroken run longer than a phone is wide, which every
    // page that shows the reason has to wrap rather than scroll sideways.
    const reason = `مبلغ رسید با مبلغ سفارش نمی‌خواند: https://bank.example/r/${'abcdefghij'.repeat(7)}`;

    await placeOrder(shopper, 'cod', path);
    const orderId = await resultOrderId(shopper);
    movedOn.push(orderId);

    // The admin checks the receipt and turns it down.
    await page.goto(adminOrderPath(orderId));
    await expect(
      page.locator('[data-umami-event="admin-panel-order-receipt-open"]'),
    ).toHaveCount(1);
    await cancelWithReason(page, reason);
    await expect(page.getByText(`دلیل لغو: ${reason}`)).toBeVisible();
    expect(await sidewaysOverflow(page)).toEqual({ page: 0, main: 0 });

    // The shopper's order says so, why, and where a transfer comes back from
    // — and takes no more receipts.
    await shopper.goto(accountOrderPath(orderId));
    await expect(shopper.getByText('این سفارش لغو شد.')).toBeVisible();
    await expect(shopper.getByText(`دلیل: ${reason}`)).toBeVisible();
    await expect(
      shopper.locator('[data-umami-event="account-order-receipt-file"]'),
    ).toHaveCount(0);
    await expect(shopper.getByText('رد شده', { exact: true })).toBeVisible();
    expect(await sidewaysOverflow(shopper)).toEqual({ page: 0, main: 0 });

    // The checkout result page says it too, in its own words.
    await shopper.goto(checkoutResultPath(orderId));
    await expect(shopper.getByText(reason, { exact: false })).toBeVisible();
    expect(await sidewaysOverflow(shopper)).toEqual({ page: 0, main: 0 });

    await shopper.goto(path);
    await expect(stockLeft(stock)).toBeVisible();
  });

  test('pages past the end of a list still lead back to it', async ({
    page,
    shopper,
  }) => {
    // At least one order, so the orders list has a page to come back to.
    await placeOrder(shopper, 'cod');
    const orderId = await resultOrderId(shopper);

    try {
      for (const { pastTheEnd, empty, row } of [
        {
          pastTheEnd: `${PROTECTED_PATHS.ORDERS}?page=999`,
          empty: 'این صفحه سفارشی ندارد.',
          row: 'admin-panel-orders-view',
        },
        {
          // Narrowed to one seeded product, the list has exactly one page however
          // many products the database holds: the case the pager used to hide on.
          pastTheEnd: `${PROTECTED_PATHS.PRODUCTS}?${new URLSearchParams({
            q: SEED_PRODUCTS[0].title,
            page: '999',
          })}`,
          empty: 'این صفحه محصولی ندارد.',
          row: 'admin-panel-products-edit',
        },
      ]) {
        await page.goto(pastTheEnd);
        await expect(page.getByText(empty)).toBeVisible();
        // Back to the last page that exists, whether the list has one page or many.
        await page.getByRole('link', { name: 'صفحه قبل' }).click();
        await expect(
          page.locator(`[data-umami-event="${row}"]`).first(),
        ).toBeVisible();
      }
    } finally {
      await closeOrder(page, orderId);
    }
  });

  test('a list reopened from the sidebar drops the filters it showed', async ({
    page,
  }) => {
    // Filtered by a full page load, as the GET form's submit is. The sidebar
    // link back to the same list is a client-side navigation, which updates the
    // page in place: a form left mounted keeps showing, and re-submits, a
    // filter the list no longer applies.
    for (const { filtered, list, controls } of [
      {
        filtered: `${PROTECTED_PATHS.ORDERS}?${new URLSearchParams({
          status: ORDER_STATUSES.PAID,
        })}`,
        list: PROTECTED_PATHS.ORDERS,
        controls: [
          {
            name: 'فیلتر وضعیت سفارش',
            applied: ORDER_STATUSES.PAID,
            reset: '',
          },
        ],
      },
      {
        filtered: productsHref(
          adminProductFilterSchema.parse({
            category: SEED_CATEGORIES[0].slug,
            active: 'inactive',
          }),
          1,
        ),
        list: PROTECTED_PATHS.PRODUCTS,
        controls: [
          {
            name: 'دسته‌بندی',
            applied: SEED_CATEGORIES[0].slug,
            reset: '',
          },
          { name: 'وضعیت نمایش', applied: 'inactive', reset: 'all' },
        ],
      },
    ]) {
      await page.goto(filtered);
      for (const { name, applied } of controls) {
        await expect(page.getByRole('combobox', { name })).toHaveValue(applied);
      }

      // The drawer hides the sidebar below `lg`.
      const menu = page.locator(
        '[data-umami-event="admin-panel-mobile-menu-open"]',
      );
      if (await menu.isVisible()) await menu.click();
      await page
        .locator(`[data-umami-event^="admin-panel-nav-"][href="${list}"]`)
        .click();
      await expect(page).toHaveURL(new RegExp(`${list}$`));

      for (const { name, reset } of controls) {
        await expect(page.getByRole('combobox', { name })).toHaveValue(reset);
      }
    }
  });
});

test.describe('a product family in the admin panel', () => {
  test.use({ storageState: ADMIN_STATE });

  // Reads the seeded family and changes nothing, so it runs at both widths and
  // leaves no row behind — unlike the catalog spec, which creates products.
  const members = SEED_PRODUCTS.filter((product) => product.variantOfSku);
  const head = SEED_PRODUCTS.find((product) =>
    members.some((member) => member.variantOfSku === product.sku),
  );
  const member = members[0];

  test('lists every member by name and refuses to nest one deeper', async ({
    page,
  }) => {
    if (!head || !member) throw new Error('The seed needs a product family.');

    // The panel shows the members the shop hides — otherwise the 10kg bag
    // could never be repriced. Searched by title, which both rows share, so
    // the label is the only thing telling them apart in the list.
    await page.goto(
      `${PROTECTED_PATHS.PRODUCTS}?${new URLSearchParams({ q: head.title })}`,
    );
    // `exact`: each row also holds its closed delete dialog, whose heading
    // quotes the same name inside a longer sentence.
    await expect(
      page.getByText(`${head.title} — ${head.variantLabel}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${member.title} — ${member.variantLabel}`, {
        exact: true,
      }),
    ).toBeVisible();

    // Counted and numbered from the filtered result, not the whole catalog:
    // the family fits on one page, so the count is exactly the rows listed.
    const rows = page.getByRole('row').filter({
      has: page.locator('[data-umami-event="admin-panel-products-edit"]'),
    });
    const listed = await rows.count();
    await expect(
      page.getByText(`${formatNumber(listed)} محصول`, { exact: true }),
    ).toBeVisible();
    await expect(rows.first().getByRole('cell').first()).toHaveText(
      formatNumber(1),
    );
    await expect(rows.last().getByRole('cell').first()).toHaveText(
      formatNumber(listed),
    );

    // The head already has members, so it cannot itself become one: one level
    // only, and moving it would orphan them. The select is disabled with the
    // reason rather than silently accepting a save the DAO would refuse.
    // By the displayed name, not the bare title: all three rows share a title,
    // and before the label fix these three links were indistinguishable.
    await page
      .getByRole('link', {
        name: `ویرایش ${head.title} — ${head.variantLabel}`,
      })
      .click();
    const headSelect = page.locator('select[id$="variantOf"]');
    await expect(headSelect).toBeDisabled();

    // A member, by contrast, may be re-pointed — its own select is live and
    // already names the head it hangs off.
    await page.goto(
      `${PROTECTED_PATHS.PRODUCTS}?${new URLSearchParams({ q: head.title })}`,
    );
    await page
      .getByRole('link', {
        name: `ویرایش ${member.title} — ${member.variantLabel}`,
      })
      .click();
    await expect(page.locator('select[id$="variantOf"]')).toBeEnabled();

    // And it is offered no filing of its own: a family is filed once, on its
    // head, because the shop lists heads and a member's own category could
    // never reach a shelf. The head's form has all three.
    await expect(page.locator('select[id$="categoryId"]')).toHaveCount(0);
    await expect(
      page.getByText('دسته‌بندی‌های دیگر (اختیاری)', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('از محصول اصلی گرفته می‌شود')).toBeVisible();

    await page.goto(
      `${PROTECTED_PATHS.PRODUCTS}?${new URLSearchParams({ q: head.title })}`,
    );
    await page
      .getByRole('link', {
        name: `ویرایش ${head.title} — ${head.variantLabel}`,
      })
      .click();
    await expect(page.locator('select[id$="categoryId"]')).toBeVisible();
  });
});
