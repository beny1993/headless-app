// The shop's filter panel: the chips that say what is filtering the results,
// the button that lets go of all of them, and the price slider.
//
// Read-only — every spec here navigates and reads, and leaves no row behind —
// so it runs at both widths. That matters more here than anywhere else in the
// suite: the panel is a sidebar at 1280 and a bottom sheet at 375, and two of
// the behaviours below only ever went wrong inside the sheet.
import type { Page } from '@playwright/test';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { shopPath } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { expect, test } from './support';

/** A seeded top-level category with products in it — never restated here. */
const category = SEED_CATEGORIES.find((row) =>
  SEED_PRODUCTS.some((product) => product.categorySlug === row.slug),
);
if (!category) {
  throw new Error('The catalog seed files no product in a top-level category.');
}

/**
 * The panel is a sidebar at desktop width and a sheet behind a button at a
 * phone's. Opening it is the only difference; every control below is then the
 * visible one of the two copies the page renders.
 */
async function openFilters(page: Page) {
  const sheetButton = page.locator(
    '[data-umami-event="shop-filter-sheet-open"]',
  );
  if (await sheetButton.isVisible()) await sheetButton.click();
}

/** The visible copy of a control — the sidebar's at 1280, the sheet's at 375. */
const control = (page: Page, event: string) =>
  page.locator(`[data-umami-event="${event}"]:visible`);

/**
 * One category row. The event name sits on the radio, which is `sr-only` — a
 * shopper clicks the label, so this does too. Anchored, or «غذای خشک» would
 * also match a row that merely starts with it.
 */
const categoryRow = (page: Page, title: string) =>
  page.locator('label:visible').filter({ hasText: new RegExp(`^${title}$`) });

/**
 * «۱۳ محصول» — the match count, which is the one thing on the page that says
 * a filter did something. The cart drawer's and the product page's own
 * `aria-live` spans are not on this route.
 */
const resultCount = (page: Page) =>
  page.locator('main span[aria-live="polite"]');

test('a filter says it is on, and its chip lets go of it', async ({ page }) => {
  await page.goto(shopPath({}));
  const everything = await resultCount(page).innerText();

  await openFilters(page);
  await categoryRow(page, category.title).click();

  await expect(page).toHaveURL(new RegExp(`category=${category.slug}`));
  await expect(resultCount(page)).not.toHaveText(everything);

  // Reopened, because applying a filter closes the sheet — which is the point
  // of it, and which «پاک کردن همه» used to skip straight past.
  await openFilters(page);
  // The panel already encoded this across three sections; the chip is what
  // turns «why am I seeing these» into a glance.
  const chip = control(page, 'shop-filter-chip-remove').filter({
    hasText: category.title,
  });
  await expect(chip).toBeVisible();

  await chip.click();

  await expect(page).not.toHaveURL(/category=/);
  await expect(resultCount(page)).toHaveText(everything);
});

test('«پاک کردن همه» drops the filters and keeps the search', async ({
  page,
}) => {
  const term = SEED_PRODUCTS[0].title.split(' ')[0];
  await page.goto(
    `${shopPath({ category: category.slug })}&q=${encodeURIComponent(term)}`,
  );

  await openFilters(page);
  await control(page, 'shop-filter-clear').click();

  // It used to be a bare link to `/shop`, which also threw away the search
  // term — and, being a link, navigated past the sheet and left it open over
  // the results it had just changed.
  await expect(page).not.toHaveURL(/category=/);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(term)}`));
  await expect(control(page, 'shop-search-type')).toHaveValue(term);
});

test('the price slider filters on release, and only then', async ({ page }) => {
  await page.goto(shopPath({}));
  const everything = await resultCount(page).innerText();

  await openFilters(page);
  const lowest = control(page, 'shop-filter-min-price-drag');
  const highest = control(page, 'shop-filter-max-price-drag');

  // Arriving on a handle is not a filter. The browser sends `keyup` to the
  // element the Tab *lands* on, so tabbing from one handle to the other used
  // to navigate — and inside the sheet that also closed it, which put the
  // price filter out of a keyboard shopper's reach entirely.
  await lowest.focus();
  await lowest.press('Tab');

  // Still on the handle it tabbed to: at a phone's width the commit closed the
  // sheet, and the focus went with it — this control could be reached and then
  // not used. The wasted push at desktop width leaves nothing to look at, so
  // that half is pinned by the panel's own component test instead.
  await expect(highest).toBeFocused();
  await expect(page).not.toHaveURL(/Price=/);
  await expect(resultCount(page)).toHaveText(everything);

  // `Home` rather than an arrow: under `dir="rtl"` the browser flips which
  // arrow lowers a range input, and this spec is not about that.
  await highest.press('Home');

  await expect(page).toHaveURL(/maxPrice=/);
  await openFilters(page);
  await expect(
    control(page, 'shop-filter-chip-remove').filter({ hasText: 'تا' }),
  ).toBeVisible();
});

test('a price bound below the catalogue never shows a negative price', async ({
  page,
}) => {
  // `?maxPrice=1` is under the cheapest product. Clamped on one side each, the
  // two handles arrived crossed and one nudge rendered «−۹٬۹۹۹ تا ۱» — a
  // negative Toman price, against the money rule.
  await page.goto(`${shopPath({})}?maxPrice=1`);
  await openFilters(page);

  const printed = await control(page, 'shop-filter-min-price-drag')
    .locator('xpath=ancestor::fieldset')
    .innerText();
  expect(printed).not.toContain(String.fromCharCode(0x2212));
  expect(printed).not.toContain('-');

  const low = Number(
    await control(page, 'shop-filter-min-price-drag').inputValue(),
  );
  const high = Number(
    await control(page, 'shop-filter-max-price-drag').inputValue(),
  );
  expect(low).toBeGreaterThanOrEqual(0);
  expect(high).toBeGreaterThan(low);
  // And what it prints is what it holds, through `format.ts` like every other
  // number on the storefront.
  expect(printed).toContain(formatNumber(low));
  expect(printed).toContain(formatNumber(high));
});
