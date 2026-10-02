import {
  MAX_PRODUCT_PAGE_SIZE,
  formatPetTypes,
} from '@/lib/catalog/product-query';
import type { Page } from '@playwright/test';
import { PET_TYPES } from '@/db/schema/catalog';
import { HOME_CATEGORY_TILES } from '@/lib/catalog/category-tree';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { formatNumber, formatToman } from '@/lib/format';
import {
  DEFAULT_SHOP_QUERY,
  SHOP_SORT_OPTIONS,
  buildShopHref,
} from '@/features/storefront/shop/shop-query';
import {
  GALLERY_PRODUCT,
  IN_STOCK_PRODUCT,
  SOLD_OUT_PRODUCT,
  expect,
  test,
} from './support';

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
/** The seeded family: the head and the members that point at it. */
const familyMembers = SEED_PRODUCTS.filter((product) => product.variantOfSku);
const familyHead = SEED_PRODUCTS.find((product) =>
  familyMembers.some((member) => member.variantOfSku === product.sku),
);
if (!familyHead || familyMembers.length === 0) {
  throw new Error('The catalog seed needs one product family.');
}
/**
 * What the card prints and opens: the cheapest member a shopper can buy, and
 * another one in stock to walk to. The seed sells the head out and prices it
 * lowest, so a card printing the family's overall minimum, or opening the
 * head, fails below.
 */
const buyable = familyMembers.filter((member) => member.stock > 0);
const cheapest = buyable.reduce((best, product) =>
  product.price < best.price ? product : best,
);
const sibling = buyable.find((member) => member !== cheapest);
if (familyHead.stock !== 0 || familyHead.price >= cheapest.price || !sibling) {
  throw new Error(
    'The family seed must sell out its head, price it lowest, and keep two members in stock.',
  );
}

const mainCategory = subOf(multiCategory.categorySlug);
const grooming = subOf(bothPets.categorySlug);
if (!mainCategory || !grooming) {
  throw new Error('Both seeded products should sit in a sub-category.');
}

/**
 * The seeded sold-out product, and the cheapest listed in-stock product of its
 * pet that costs more. Capped there, its pet's shelf has a card a shopper can
 * buy priced above it, so the cheapest-first sort alone would list it ahead
 * of that card.
 */
const soldOut = SEED_PRODUCTS.find(
  (product) => product.stock === 0 && !product.variantLabel,
);
const dearerInStock = SEED_PRODUCTS.filter(
  (product) =>
    soldOut &&
    product.stock > 0 &&
    !product.variantOfSku &&
    product.petTypes.includes(soldOut.petTypes[0]) &&
    product.price > soldOut.price,
).sort((a, b) => a.price - b.price)[0];
if (!soldOut || !dearerInStock) {
  throw new Error('The seed needs an in-stock product dearer than sold-out.');
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

  // The cart is exercised on the best-stocked product, which no run's orders
  // ever empty — the first card may be a family, which has no add button.
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

test('the home category mosaic fills its grid, tall tiles and all', async ({
  page,
  isMobile,
}) => {
  await page.goto(PATHS.HOME);
  const tiles = page.locator('[data-umami-event="home-category-click"]');
  await expect(tiles).toHaveCount(HOME_CATEGORY_TILES);
  // Rounded, so a subpixel never splits one column into two.
  const boxes = await tiles.evaluateAll((links) =>
    links.map((link) => {
      const { left, bottom, height } = link.getBoundingClientRect();
      return {
        left: Math.round(left),
        bottom: Math.round(bottom),
        height: Math.round(height),
      };
    }),
  );

  // No empty cell: every column runs down to the grid's bottom edge. Six tiles
  // with only two tall ones fill 8 of a desktop grid's 9 cells.
  const gridBottom = Math.max(...boxes.map((box) => box.bottom));
  const columns = new Set(boxes.map((box) => box.left));
  expect(columns.size).toBe(isMobile ? 2 : 3);
  for (const left of columns) {
    const column = boxes.filter((box) => box.left === left);
    expect(Math.max(...column.map((box) => box.bottom))).toBe(gridBottom);
  }

  // And the tall tiles are two rows tall — not a row that collapsed because
  // nothing short sits in it: three of them at desktop width, two on a phone.
  // The tiles' content is all absolutely positioned, so without the grid's
  // own row height every one of them collapses to nothing.
  const shortest = Math.min(...boxes.map((box) => box.height));
  expect(shortest).toBeGreaterThan(0);
  expect(boxes.filter((box) => box.height > 1.5 * shortest)).toHaveLength(
    isMobile ? 2 : 3,
  );
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

test('shop grid and list hide sold-out prices and keep buyable prices', async ({
  page,
}) => {
  await page.goto(
    buildShopHref({ ...DEFAULT_SHOP_QUERY, limit: MAX_PRODUCT_PAGE_SIZE }),
  );
  const soldOutCard = page.locator('article', {
    has: cardsFor(page, soldOut.title),
  });
  const stockedCard = page.locator('article', {
    has: cardsFor(page, dearerInStock.title),
  });
  const familyCard = page.locator('article', {
    has: cardsFor(page, familyHead.title),
  });

  for (const view of ['grid', 'list'] as const) {
    await page.locator(`[data-umami-event="shop-view-${view}"]`).click();
    await expect(soldOutCard).toBeVisible();
    await expect(soldOutCard).toContainText('ناموجود');
    await expect(soldOutCard).not.toContainText('تومان');
    await expect(soldOutCard).not.toContainText(formatNumber(soldOut.price));
    await expect(
      soldOutCard.locator('[data-umami-event="product-card-add-to-cart"]'),
    ).toHaveCount(0);
    await expect(stockedCard).toContainText(formatToman(dearerInStock.price));
    // The head itself is sold out, but its siblings can still be bought.
    await expect(familyCard).toContainText(`از ${formatToman(cheapest.price)}`);
    await expect(familyCard).not.toContainText('ناموجود');
    await expect(
      familyCard.locator('[data-umami-event="product-card-choose"]'),
    ).toBeVisible();
  }

  await cardsFor(page, soldOut.title).click();
  await expect(page).toHaveURL(new RegExp(`${soldOut.slug}$`));
  // Price visibility on the detail page stays as before.
  await expect(page.locator('main')).toContainText(formatToman(soldOut.price));
});

test('every sort lists the products in stock before the sold-out ones', async ({
  page,
}) => {
  await page.goto(
    buildShopHref({
      ...DEFAULT_SHOP_QUERY,
      pet: soldOut.petTypes[0],
      maxPrice: dearerInStock.price,
      limit: MAX_PRODUCT_PAGE_SIZE,
    }),
  );
  const sort = page.locator('[data-umami-event="shop-sort-change"]');
  const cards = page
    .locator('article')
    .filter({ has: page.locator('[data-umami-event="product-card-open"]') });

  for (const { value } of SHOP_SORT_OPTIONS) {
    if (value !== DEFAULT_SHOP_QUERY.sort) {
      await sort.selectOption(value);
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('sort') === value,
      );
    }
    // Both kinds are on the page, so the order below says something.
    await expect(cardsFor(page, soldOut.title)).toBeVisible();
    await expect(cardsFor(page, dearerInStock.title)).toBeVisible();
    // The card's «ناموجود» badge, in page order: every false before any true.
    const soldOutInOrder = await cards.evaluateAll((articles) =>
      articles.map((article) => article.textContent?.includes('ناموجود')),
    );
    expect(soldOutInOrder).toEqual(
      [...soldOutInOrder].sort((a, b) => Number(a) - Number(b)),
    );
  }
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

  // «از ۱۴۹٬۰۰۰ تومان» — the cheapest smell a shopper can buy. The head is
  // sold out and cheaper still, so printing the family's overall minimum —
  // or the head's own price — would fail here.
  const card = page.locator('article', { has: cards });
  await expect(card).toContainText(`از ${formatNumber(cheapest.price)}`);
  await expect(card).not.toContainText(formatNumber(familyHead.price));

  // A family is chosen, never quick-added: adding the head from the grid would
  // pick a smell nobody asked for.
  await expect(
    card.locator('[data-umami-event="product-card-add-to-cart"]'),
  ).toHaveCount(0);
  await card.locator('[data-umami-event="product-card-choose"]').click();

  // Not the sold-out head's page: the member whose price the card printed.
  // Heading is title + label, and every other member is a chip — the head's
  // saying it is sold out.
  await expect(page).toHaveURL(new RegExp(`${cheapest.slug}$`));
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `${cheapest.title} — ${cheapest.variantLabel}`,
    }),
  ).toBeVisible();
  const chips = page.locator('[data-umami-event="product-variant-open"]');
  await expect(chips).toHaveCount(familyMembers.length);
  await expect(
    chips.filter({ hasText: familyHead.variantLabel! }),
  ).toContainText('ناموجود');

  // Picking a sibling is ordinary navigation to that member's own slug — swapped
  // in place, from where the shopper was. Scrolled past the page's top first:
  // only then does Next's default throw the page back up, which is what read as
  // a reload. (This run blanks Umami, so its full reload on a tracked link is
  // pinned by src/app/layout.test.ts and umami-tracker.test.tsx, not here.)
  const chip = chips.filter({ hasText: sibling.variantLabel! });
  await chip.evaluate((element) =>
    window.scrollTo(
      0,
      Math.max(120, element.getBoundingClientRect().top + window.scrollY - 300),
    ),
  );
  const scrolled = await page.evaluate(() => window.scrollY);
  // Next scrolls only when the new page's top is off-screen, so a taller
  // header would skip the jump this checks for without failing anything.
  expect(
    await page
      .locator('main')
      .evaluate((element) => element.getBoundingClientRect().top),
  ).toBeLessThan(0);
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`${sibling.slug}$`));
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `${sibling.title} — ${sibling.variantLabel}`,
    }),
  ).toBeVisible();
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - scrolled)).toBeLessThanOrEqual(40);
  // Its own price, not the family's «از …» — this is a single product now.
  await expect(page.locator('main')).toContainText(formatNumber(sibling.price));

  // The line a shopper ends up buying names the member, because the cart title
  // and the order snapshot come from the same derivation.
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  const drawer = page.getByRole('dialog', { name: 'سبد خرید' });
  await expect(drawer).toContainText(
    `${sibling.title} — ${sibling.variantLabel}`,
  );
  await drawer.locator('[data-umami-event="cart-line-remove"]').click();
});

test('a product gallery moves to the photo its thumbnail names', async ({
  page,
}) => {
  // Runs at 375px as well as 1280px, which is the reason it exists: the admin
  // spec that builds a multi-photo product is desktop-only, so before this the
  // strip and the swipe track were never opened at phone width at all.
  await page.goto(GALLERY_PRODUCT.path);

  const thumbs = page.locator(
    '[data-umami-event="product-gallery-thumb-select"]',
  );
  await expect(thumbs).toHaveCount(GALLERY_PRODUCT.photoCount);
  await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');

  // The LAST thumb: two or more slides away, so the jump has to pass a snap
  // point to arrive. `scroll-snap-stop: always` refuses to let any scroll pass
  // one, so this landed on the middle photo until the track learned to
  // suspend snapping for a jump it was told to make.
  await thumbs.last().click();
  await expect(thumbs.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'false');

  // And back to the first, so the return trip is covered too — the delta is
  // the other sign, which in RTL is where the arithmetic would go wrong.
  await thumbs.first().click();
  await expect(thumbs.first()).toHaveAttribute('aria-pressed', 'true');
});
