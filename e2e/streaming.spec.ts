// What `Story - Storefront Caching and Streaming` changed about how pages
// arrive: the shop sends its heading, search and filters before the listing
// and streams the product grid in behind a skeleton, and `/account` and the
// admin panel answer with a loading skeleton at once. The cache half is pinned
// where admins save (admin-categories, admin-settings, admin-provinces): each
// checks the storefront right after the save.
//
// Streaming is read off the HTML the server sends (`request.get`). React
// writes a boundary's fallback as markup only while the boundary is still
// waiting when the shell is done, so content that beats the shell leaves no
// skeleton markup: its order is asserted whenever it is there. What holds on
// every run is the page's RSC payload, which the same HTML carries for
// hydration and which holds each boundary's fallback whoever wins. A skeleton
// found in neither therefore means its boundary is gone. Proven by removing
// each one (the shop's <Suspense>, each loading.tsx): the spec then fails on
// every run. That the shop sends the rest without waiting for its listing is
// a promise no timing here can check; `src/app/(app)/(store)/shop/page.test.ts`
// pins it.
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { SHOP_TITLE } from '@/features/storefront/shop/shop-metadata';
import { PATHS, PROTECTED_PATHS, shopPath } from '@/lib/constant/paths';
import { ADMIN_STATE, CUSTOMER_STATE, expect, test } from './support';

const SHELF_SKELETON = 'shop-shelf-skeleton';

/**
 * The page's RSC payload as one string. Next writes it into the HTML as a run
 * of `self.__next_f.push([1,"…"])` scripts, one per chunk React flushed, and a
 * chunk ends wherever it fills, so a test id can straddle two scripts.
 */
function rscPayload(html: string): string {
  return [
    ...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g),
  ]
    .map((match) => JSON.parse(match[1] ?? '""') as string)
    .join('');
}

/**
 * Where a skeleton is in the HTML the server sent: `markup`, the index of the
 * rendered element (-1 when the content beat the shell), and `shipped`, true
 * when it is there or in the RSC payload.
 */
function skeletonIn(html: string, testId: string) {
  const markup = html.indexOf(`data-testid="${testId}"`);
  return { markup, shipped: markup > -1 || rscPayload(html).includes(testId) };
}

test.describe('the shop', () => {
  test('sends heading and filters first, then streams the grid in', async ({
    page,
  }) => {
    const html = await (await page.request.get(PATHS.SHOP)).text();
    const heading = html.indexOf(`>${SHOP_TITLE}</h1>`);
    const skeleton = skeletonIn(html, SHELF_SKELETON);
    // A product card is an <article>; the first one arrives after the fallback.
    const firstCard = html.indexOf('<article');

    expect(heading).toBeGreaterThan(-1);
    expect(firstCard).toBeGreaterThan(heading);
    expect(skeleton.shipped).toBe(true);
    if (skeleton.markup > -1) {
      expect(skeleton.markup).toBeGreaterThan(heading);
      expect(firstCard).toBeGreaterThan(skeleton.markup);
    }
    expect(html).toContain('data-umami-event="shop-search-type"');
  });

  test('ends with the grid on screen and no skeleton left', async ({
    page,
  }) => {
    await page.goto(PATHS.SHOP);

    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByTestId(SHELF_SKELETON)).toHaveCount(0);
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
    expect(await response.text()).not.toContain(SHELF_SKELETON);
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
      const skeleton = skeletonIn(html, 'account-skeleton');

      expect(skeleton.shipped).toBe(true);
      expect(html.indexOf('>سفارش‌های من</h2>')).toBeGreaterThan(
        skeleton.markup,
      );

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
      const skeleton = skeletonIn(html, 'admin-panel-skeleton');

      expect(skeleton.shipped).toBe(true);
      expect(html.indexOf('>داشبورد</h1>')).toBeGreaterThan(skeleton.markup);
    });
  });
});
