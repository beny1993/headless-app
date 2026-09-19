import { formatPetTypes } from '@/lib/catalog/product-query';
import type { Page } from '@playwright/test';
import { PET_TYPES } from '@/db/schema/catalog';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';
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
/** The seeded family: the head, the members that point at it, the cheapest. */
const familyMembers = SEED_PRODUCTS.filter((product) => product.variantOfSku);
const familyHead = SEED_PRODUCTS.find((product) =>
  familyMembers.some((member) => member.variantOfSku === product.sku),
);
if (!familyHead || familyMembers.length === 0) {
  throw new Error('The catalog seed needs one product family.');
}
/** Head included: the «از …» price is the whole family's minimum. */
const cheapest = [familyHead, ...familyMembers].reduce((best, product) =>
  product.price < best.price ? product : best,
);
if (cheapest.price === familyHead.price) {
  throw new Error('The family seed must price a member below its head.');
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

test('a product family is one card, and its page picks the member', async ({
  page,
}) => {
  // One card in the shop for the whole family — the head is listed, the members
  // are reached from its page. The controls are the two members' own labels:
  // without the `variant_of is null` predicate each would be a card of its own,
  // and this reads 3 instead of 1.
  await page.goto(shopPath({ category: familyHead.categorySlug }));
  const cards = cardsFor(page, familyHead.title);
  await expect(cards).toHaveCount(1);

  // «از ۱۴۹٬۰۰۰ تومان» — the family's cheapest, not the head's own price. The
  // seed prices «بدون بو» below the other two precisely so this is not a
  // tautology: printing `familyHead.price` here would fail.
  const card = page.locator('article', { has: cards });
  await expect(card).toContainText(`از ${formatNumber(cheapest.price)}`);
  await expect(card).not.toContainText(formatNumber(familyHead.price));

  // A family is chosen, never quick-added: adding the head from the grid would
  // pick a smell nobody asked for.
  await expect(
    card.locator('[data-umami-event="product-card-add-to-cart"]'),
  ).toHaveCount(0);
  await card.locator('[data-umami-event="product-card-choose"]').click();

  // The head's own page: heading is title + label, and every member is a chip.
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `${familyHead.title} — ${familyHead.variantLabel}`,
    }),
  ).toBeVisible();
  const chips = page.locator('[data-umami-event="product-variant-open"]');
  await expect(chips).toHaveCount(familyMembers.length);

  // Picking a sibling is ordinary navigation to that member's own slug.
  await chips.filter({ hasText: cheapest.variantLabel! }).click();
  await expect(page).toHaveURL(new RegExp(`${cheapest.slug}$`));
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `${cheapest.title} — ${cheapest.variantLabel}`,
    }),
  ).toBeVisible();
  // Its own price, not the family's «از …» — this is a single product now.
  await expect(page.locator('main')).toContainText(
    formatNumber(cheapest.price),
  );

  // The line a shopper ends up buying names the member, because the cart title
  // and the order snapshot come from the same derivation.
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  const drawer = page.getByRole('dialog', { name: 'سبد خرید' });
  await expect(drawer).toContainText(
    `${cheapest.title} — ${cheapest.variantLabel}`,
  );
  await drawer.locator('[data-umami-event="cart-line-remove"]').click();
});
