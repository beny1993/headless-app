import { SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { PATHS, PROTECTED_PATHS, adminOrderPath } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import {
  ADMIN_STATE,
  CUSTOMER_STATE,
  LOW_STOCK_PRODUCT,
  expect,
  placeOrder,
  resultOrderId,
  test,
} from './support';

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

  test('finds a new order and ships it', async ({ page, shopper }) => {
    // The order comes from a real checkout, in the customer's own session.
    await placeOrder(shopper, 'cod');
    const orderId = await resultOrderId(shopper);

    await page.goto(PROTECTED_PATHS.ORDERS);
    await page
      .locator(
        `[data-umami-event="admin-panel-orders-view"][href="${adminOrderPath(orderId)}"]`,
      )
      .click();

    // Cash on delivery skips the gateway and starts in fulfilment, where
    // shipping is the next move — and delivery is the only move after it.
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
  });

  test('cancels an order and its stock comes back', async ({
    page,
    shopper,
  }) => {
    const { path, stock } = LOW_STOCK_PRODUCT;
    const stockLeft = (count: number) =>
      shopper.getByText(`تنها ${formatNumber(count)} عدد باقی مانده`);

    await placeOrder(shopper, 'cod', path);
    const orderId = await resultOrderId(shopper);
    await shopper.goto(path);
    await expect(stockLeft(stock - 1)).toBeVisible();

    await page.goto(adminOrderPath(orderId));
    const cancel = page.locator(
      '[data-umami-event="admin-panel-order-transition-cancelled"]',
    );
    await cancel.click();
    // Cancelled is terminal: nothing is offered after it.
    await expect(cancel).toBeHidden();

    await shopper.goto(path);
    await expect(stockLeft(stock)).toBeVisible();
  });

  test('pages past the end of a list still lead back to it', async ({
    page,
    shopper,
  }) => {
    // At least one order, so the orders list has a page to come back to.
    await placeOrder(shopper, 'cod');
    await resultOrderId(shopper);

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
  });
});
