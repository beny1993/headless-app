import { PATHS, PROTECTED_PATHS, adminOrderPath } from '@/lib/constant/paths';
import {
  ADMIN_STATE,
  CUSTOMER_STATE,
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

  test('finds a new order and ships it', async ({ page, browser, baseURL }) => {
    // The order comes from a real checkout, in the customer's own session.
    const shopper = await browser.newContext({
      baseURL,
      storageState: CUSTOMER_STATE,
    });
    const shopperPage = await shopper.newPage();
    await placeOrder(shopperPage, 'cod');
    const orderId = await resultOrderId(shopperPage);
    await shopper.close();

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
});
