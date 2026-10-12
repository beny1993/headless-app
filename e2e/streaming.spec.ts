// What `Story - Storefront Caching and Streaming` changed about how pages
// arrive: the shop sends its heading, search and filters before the listing
// and streams the product grid in behind a skeleton, and `/account` and the
// admin panel answer with a loading skeleton at once. The cache half is pinned
// where admins save (admin-categories, admin-settings, admin-provinces): each
// checks the storefront right after the save.
//
// Streaming is read off the HTML the server sends (`request.get`): the
// fallback is in the document, ahead of the content that replaces it. That is
// the shape a browser receives, without a timing race to win in a test.
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { PATHS, PROTECTED_PATHS, shopPath } from '@/lib/constant/paths';
import { ADMIN_STATE, CUSTOMER_STATE, expect, test } from './support';

const SKELETON = 'data-testid="shop-shelf-skeleton"';

test.describe('the shop', () => {
  test('sends heading and filters first, then streams the grid in', async ({
    page,
  }) => {
    const html = await (await page.request.get(PATHS.SHOP)).text();
    const heading = html.indexOf('<h1');
    const skeleton = html.indexOf(SKELETON);
    // A product card is an <article>; the first one arrives after the fallback.
    const firstCard = html.indexOf('<article');

    expect(heading).toBeGreaterThan(-1);
    expect(skeleton).toBeGreaterThan(heading);
    expect(firstCard).toBeGreaterThan(skeleton);
    expect(html).toContain('data-umami-event="shop-search-type"');
  });

  test('ends with the grid on screen and no skeleton left', async ({
    page,
  }) => {
    await page.goto(PATHS.SHOP);

    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByTestId('shop-shelf-skeleton')).toHaveCount(0);
    // The toolbar's count arrived with the grid it counts.
    await expect(
      page.locator('[aria-live="polite"]', { hasText: /محصول$/ }),
    ).toBeVisible();
  });

  test('keeps a real 404 for a category that does not exist', async ({
    page,
  }) => {
    const response = await page.request.get(
      shopPath({ category: 'no-such-shelf' }),
    );

    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain(SKELETON);
  });

  test('the phone filter sheet counts the shelf once the listing is in', async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 1024,
      'the sheet is the phone layout',
    );
    const category = SEED_CATEGORIES[0]!;
    await page.goto(shopPath({ category: category.slug }));
    await expect(page.locator('article').first()).toBeVisible();
    // The toolbar's count, rendered with the grid: the sheet must agree.
    const count = await page
      .locator('[aria-live="polite"]', { hasText: /محصول$/ })
      .first()
      .textContent();

    await page.locator('[data-umami-event="shop-filter-sheet-open"]').click();
    await expect(
      page.locator('[data-umami-event="shop-filter-sheet-apply"]'),
    ).toHaveText(`نمایش ${count}`);
  });
});

test.describe('loading skeletons', () => {
  test.describe('a shopper', () => {
    test.use({ storageState: CUSTOMER_STATE });

    test('gets the account skeleton first, then their account', async ({
      page,
    }) => {
      const html = await (await page.request.get(PATHS.ACCOUNT)).text();
      const skeleton = html.indexOf('در حال بارگذاری حساب کاربری');

      expect(skeleton).toBeGreaterThan(-1);
      expect(html.indexOf('سفارش‌های من')).toBeGreaterThan(skeleton);

      await page.goto(PATHS.ACCOUNT);
      await expect(
        page.getByRole('heading', { name: 'سفارش‌های من' }),
      ).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'در حال بارگذاری حساب کاربری' }),
      ).toHaveCount(0);
    });
  });

  test.describe('an admin', () => {
    test.use({ storageState: ADMIN_STATE });

    test('gets the panel skeleton first, then the page', async ({ page }) => {
      const html = await (await page.request.get(PROTECTED_PATHS.INDEX)).text();
      const skeleton = html.indexOf('aria-label="در حال بارگذاری"');

      expect(skeleton).toBeGreaterThan(-1);
      expect(html.indexOf('>داشبورد</h1>')).toBeGreaterThan(skeleton);
    });
  });
});
