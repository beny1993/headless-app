// The admin «پرطرفدارها» page: who may see it, and a sale the suite makes
// showing up in it. A paid Zarinpal order through the mock gateway is the one
// kind that is revenue the moment it settles (a card-to-card order is not
// until the admin ships it), so that is what the shopper places.
//
// The suite's web server runs with no Umami (no script URL, no viewer), so
// what this walks is the sales-only page and its notice; the view numbers'
// joins, roll-ups and failure modes are the unit tests' (product-insights.test.ts,
// umami/client.test.ts).
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  ADMIN_STATE,
  CUSTOMER_STATE,
  IN_STOCK_TITLE,
  expect,
  placeOrder,
  test,
} from './support';

test('a signed-out visitor is sent to sign in first', async ({ page }) => {
  await page.goto(PROTECTED_PATHS.INSIGHTS);
  await expect(page).toHaveURL((url) => url.pathname === PATHS.LOGIN);
});

test.describe('a customer', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('is turned away', async ({ page }) => {
    await page.goto(PROTECTED_PATHS.INSIGHTS);
    await expect(page).toHaveURL((url) => url.pathname === PATHS.HOME);
  });
});

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('sees a paid sale under each window, and can open the product', async ({
    page,
    shopper,
  }) => {
    await placeOrder(shopper, 'zarinpal');
    await shopper.locator('button[name="action"][value="pay"]').click();
    await expect(
      shopper.getByRole('heading', { name: 'پرداخت موفق بود!' }),
    ).toBeVisible();

    const navEntry = page.locator(
      `[data-umami-event^="admin-panel-nav-"][href="${PROTECTED_PATHS.INSIGHTS}"]`,
    );
    const windowLink = (days: number) =>
      page.locator(`[data-umami-event="admin-panel-insights-window-${days}"]`);
    const soldRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: IN_STOCK_TITLE }) });

    await page.goto(PROTECTED_PATHS.INSIGHTS);
    await expect(
      page.getByRole('heading', { level: 1, name: 'پرطرفدارها' }),
    ).toBeVisible();
    await expect(navEntry).toHaveAttribute('aria-current', 'page');
    // Thirty days by default.
    await expect(windowLink(30)).toHaveAttribute('aria-current', 'page');

    // No Umami here: the page says so instead of showing zeros, and still
    // shows the sales.
    await expect(page.getByRole('status')).toContainText('Umami');
    await expect(
      page.getByText('ناموجود ولی پرتقاضا', { exact: true }),
    ).toHaveCount(0);
    const viewsTile = page
      .getByText('بازدید صفحه محصولات', { exact: true })
      .locator('..');
    await expect(viewsTile).toContainText('—');

    // Every tile went through src/lib/format.ts, or it would carry ASCII digits.
    for (const label of ['تعداد فروخته‌شده', 'درآمد محصولات']) {
      const tile = page.getByText(label, { exact: true }).locator('..');
      await expect(tile).toBeVisible();
      await expect(tile).not.toContainText(/\d/);
    }
    await expect(soldRow).toBeVisible();
    await expect(soldRow).not.toContainText(/\d/);

    for (const days of [7, 90]) {
      await windowLink(days).click();
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('days') === String(days),
      );
      await expect(windowLink(days)).toHaveAttribute('aria-current', 'page');
      await expect(soldRow).toBeVisible();
    }

    // A window the page does not offer reads as the default.
    await page.goto(`${PROTECTED_PATHS.INSIGHTS}?days=31`);
    await expect(windowLink(30)).toHaveAttribute('aria-current', 'page');

    await soldRow.getByRole('link', { name: IN_STOCK_TITLE }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.startsWith(`${PROTECTED_PATHS.PRODUCTS}/`),
    );
  });
});
