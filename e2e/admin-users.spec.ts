// The admin users area: the list with its customer counts, a search by the
// number a customer typed, their account page, and the walk from it to one of
// their orders and back. Reads only, apart from the one order the customer
// places for the walk, so it runs at both widths.
import {
  PATHS,
  PROTECTED_PATHS,
  adminOrderPath,
  adminUserPath,
} from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';
import {
  ADMIN_STATE,
  CUSTOMER_STATE,
  customerPhone,
  expect,
  placeOrder,
  resultOrderId,
  test,
} from './support';

/** A made-up id of the right shape, for a page nobody may see anyway. */
const SOME_USER = adminUserPath('aB3dE5gH7jK9mN1pQ3sT5vX7zA9cD1f');

test('a signed-out visitor is sent to sign in first', async ({ page }) => {
  for (const path of [PROTECTED_PATHS.USERS, SOME_USER]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === PATHS.LOGIN);
  }
});

test.describe('a customer', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('is turned away from the users pages', async ({ page }) => {
    for (const path of [PROTECTED_PATHS.USERS, SOME_USER]) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === PATHS.HOME);
    }
  });
});

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('finds a customer by phone and walks from their account to an order and back', async ({
    page,
    shopper,
  }) => {
    // An order in the customer's own session, so their page has one to open.
    await placeOrder(shopper, 'cod');
    const orderId = await resultOrderId(shopper);
    const phone = customerPhone();
    const shownPhone = toPersianDigits(phone);

    const navEntry = page.locator(
      `[data-umami-event^="admin-panel-nav-"][href="${PROTECTED_PATHS.USERS}"]`,
    );
    const rows = page.getByRole('row').filter({
      has: page.locator('[data-umami-event="admin-panel-users-view"]'),
    });

    await page.goto(PROTECTED_PATHS.USERS);
    await expect(
      page.getByRole('heading', { level: 1, name: 'کاربران' }),
    ).toBeVisible();
    await expect(navEntry).toHaveAttribute('aria-current', 'page');
    // Both counts went through src/lib/format.ts, or they would carry ASCII
    // digits.
    const newThisMonth = 'مشتریان جدید این ماه';
    for (const label of ['کل مشتریان', newThisMonth]) {
      const card = page.getByText(label, { exact: true }).locator('..');
      await expect(card).toBeVisible();
      await expect(card).not.toContainText(/\d/);
    }
    const newCard = page.getByText(newThisMonth, { exact: true }).locator('..');
    const newCount = await newCard.textContent();

    // The dashboard's tile is the same call, so the same number.
    await page.goto(PROTECTED_PATHS.INDEX);
    await expect(newCard).toBeVisible();
    await expect(newCard).not.toContainText(/\d/);
    await expect(newCard).toHaveText(newCount ?? '');

    await page.goto(PROTECTED_PATHS.USERS);
    // Signed up this run, so on the first page of a newest-first list.
    await expect(rows.filter({ hasText: shownPhone })).toHaveCount(1);

    // Typed as the customer typed it. The table stores `+98…`, so only a
    // normalized search finds it.
    await page
      .locator('[data-umami-event="admin-panel-users-search-type"]')
      .fill(phone);
    await page
      .locator('[data-umami-event="admin-panel-users-search-submit"]')
      .click();
    await expect(page).toHaveURL((url) => url.searchParams.get('q') === phone);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(shownPhone);

    await rows.locator('[data-umami-event="admin-panel-users-view"]').click();
    const profile = page
      .getByRole('heading', { level: 2, name: 'مشخصات' })
      .locator('..');
    await expect(profile).toContainText(shownPhone);
    await expect(navEntry).toHaveAttribute('aria-current', 'page');
    const userPath = new URL(page.url()).pathname;

    await page
      .locator(
        `[data-umami-event="admin-panel-user-order-view"][href="${adminOrderPath(orderId)}"]`,
      )
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === adminOrderPath(orderId),
    );

    // Back to the account behind the order, which is the one we came from.
    await page
      .locator('[data-umami-event="admin-panel-order-customer-view"]')
      .click();
    await expect(page).toHaveURL((url) => url.pathname === userPath);
    await expect(profile).toContainText(shownPhone);
  });
});
