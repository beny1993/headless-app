import type { Page } from '@playwright/test';
import { PET_TYPES } from '@/db/schema/catalog';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';
import { formatPetTypes } from '@/features/storefront/shop/shop-query';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { IN_STOCK_PRODUCT, SOLD_OUT_PRODUCT, expect, test } from './support';

// Picked out of the seed by what makes each one interesting, never by index:
// appending a row to the catalog must not point these at another product.
const bothPets = SEED_PRODUCTS.find((product) => product.petTypes.length === 2);
const multiCategory = SEED_PRODUCTS.find(
  (product) => (product.extraCategorySlugs ?? []).length > 0,
);
const subOf = (slug: string) =>
  SEED_SUBCATEGORIES.find((sub) => sub.slug === slug);
/** One pet each, so each is the control the other pet's shelf must not show. */
const onlyFor = (pet: (typeof PET_TYPES)[keyof typeof PET_TYPES]) =>
  SEED_PRODUCTS.find(
    (product) => product.petTypes.length === 1 && product.petTypes[0] === pet,
  );
const catOnly = onlyFor(PET_TYPES.CAT);
const dogOnly = onlyFor(PET_TYPES.DOG);
if (!bothPets || !multiCategory) {
  throw new Error('The catalog seed needs a both-pets and a two-category row.');
}
if (!catOnly || !dogOnly) {
  throw new Error('The catalog seed needs a cat-only and a dog-only row.');
}
const mainCategory = subOf(multiCategory.categorySlug);
const grooming = subOf(bothPets.categorySlug);
if (!mainCategory || !grooming) {
  throw new Error('Both seeded products should sit in a sub-category.');
}

/** What the storefront calls a category, top-level or sub. */
const titleOf = (slug: string) =>
  [...SEED_CATEGORIES, ...SEED_SUBCATEGORIES].find(
    (category) => category.slug === slug,
  )?.title ?? slug;

/** The product cards on the page whose link reads `title`. */
const cardsFor = (page: Page, title: string) =>
  page.locator('[data-umami-event="product-card-open"]', { hasText: title });

test('a shopper browses from home to a product and into the cart', async ({
  page,
}) => {
  await page.goto(PATHS.HOME);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.locator('[data-umami-event="home-hero-shop-click"]').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'فروشگاه' }),
  ).toBeVisible();

  await page.locator('[data-umami-event="product-card-open"]').first().click();
  await expect(page).toHaveURL((url) =>
    url.pathname.startsWith(`${PATHS.PRODUCT}/`),
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The first card can be the sold-out product, so the cart is exercised on
  // one that always has stock.
  await page.goto(IN_STOCK_PRODUCT);
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  await page.locator('[data-umami-event="product-add-to-cart"]').click();

  const drawer = page.getByRole('dialog', { name: 'سبد خرید' });
  await expect(drawer).toContainText(title);
  // Every count and price in the drawer goes through src/lib/format.ts; an
  // ASCII digit here is one that skipped it.
  await expect(drawer).not.toContainText(/\d/);

  await drawer.locator('[data-umami-event="cart-line-increase"]').click();
  await expect(drawer).toContainText('سبد خرید (۲)');
  // The remove control is a touch target, not a caption link: 44px tall,
  // the sizing fix of 2026-09-15. Drop `min-h-11` from it and this fails.
  const remove = drawer.locator('[data-umami-event="cart-line-remove"]');
  expect((await remove.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(drawer).toContainText('سبد خرید شما خالی است');
});

test('a product for both pets is on both shelves', async ({ page }) => {
  // Suitable for cats *includes* suitable for both, so the shampoo answers
  // either pet filter, and its parent category's filter reaches down into the
  // sub-category it is actually filed under.
  // Each shelf carries a control the filter must keep *out*: without it a
  // listing that ignored the filter and showed the whole catalogue would pass
  // every line below.
  for (const { href, absent } of [
    { href: shopPath({ pet: PET_TYPES.CAT }), absent: dogOnly },
    { href: shopPath({ pet: PET_TYPES.DOG }), absent: catOnly },
    { href: shopPath({ category: grooming.parentSlug }), absent: catOnly },
  ]) {
    await page.goto(href);
    await expect(cardsFor(page, bothPets.title)).toHaveCount(1);
    await expect(cardsFor(page, absent.title)).toHaveCount(0);
  }

  await page.goto(productPath(bothPets.slug));
  await page
    .locator('[data-umami-event="product-tab-select"]', { hasText: 'مشخصات' })
    .click();
  await expect(page.getByRole('region', { name: 'مشخصات' })).toContainText(
    formatPetTypes([PET_TYPES.CAT, PET_TYPES.DOG]),
  );
});

test('a product in two categories is listed once under each', async ({
  page,
}) => {
  // Its main category and its additional one are both under «مکمل», so the
  // parent's filter matches it twice over and must still show it once.
  await page.goto(shopPath({ category: mainCategory.parentSlug }));
  await expect(cardsFor(page, multiCategory.title)).toHaveCount(1);
  // The control, as above: a product from another shelf entirely.
  await expect(cardsFor(page, catOnly.title)).toHaveCount(0);
  // The total counts what the page lists — once per product, not once per
  // matching category — and goes through src/lib/format.ts on the way out.
  const listed = await page
    .locator('[data-umami-event="product-card-open"]')
    .count();
  await expect(
    page.getByText(`${formatNumber(listed)} محصول`, { exact: true }),
  ).toBeVisible();

  for (const slug of [
    multiCategory.categorySlug,
    ...(multiCategory.extraCategorySlugs ?? []),
  ]) {
    await page.goto(shopPath({ category: slug }));
    await expect(cardsFor(page, multiCategory.title)).toHaveCount(1);
  }

  await page.goto(productPath(multiCategory.slug));
  // The breadcrumb follows the main category alone, and a sub-category brings
  // its parent along: «فروشگاه › مکمل › مالت».
  await expect(
    page.locator('[data-umami-event="product-breadcrumb-parent-category"]'),
  ).toHaveText(titleOf(mainCategory.parentSlug));
  await expect(
    page.locator('[data-umami-event="product-breadcrumb-category"]'),
  ).toHaveText(mainCategory.title);

  await page
    .locator('[data-umami-event="product-tab-select"]', { hasText: 'مشخصات' })
    .click();
  // The spec row lists every category it is filed under, main first.
  await expect(
    page.locator('[data-umami-event="product-category-link"]'),
  ).toHaveText([
    mainCategory.title,
    ...(multiCategory.extraCategorySlugs ?? []).map(titleOf),
  ]);
});

test('a sold-out product cannot go in the cart', async ({ page }) => {
  await page.goto(SOLD_OUT_PRODUCT);
  await expect(
    page.locator('[data-umami-event="product-add-to-cart-unavailable"]'),
  ).toBeDisabled();
  await expect(
    page.locator('[data-umami-event="product-add-to-cart"]'),
  ).toHaveCount(0);
});
