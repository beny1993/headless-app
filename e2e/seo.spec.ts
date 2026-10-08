// What a search engine reads: the sitemap, each page's canonical, a product's
// and the shop's structured data, a shelf's own title and breadcrumb, and a
// search kept out of the index. Head elements carry no `data-umami-event`, so
// these select the way a crawler does: `link[rel="canonical"]`,
// `meta[name="robots"]` and `script[type="application/ld+json"]`. Read-only,
// so it runs at both widths.
import type { Page } from '@playwright/test';
import { DEFAULT_SITE_NAME } from '@/constants';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';
import {
  DELIVERY_NOTE,
  HANDLING_DAYS,
  RETURN_DAYS,
  RETURN_NOTE,
  TRANSIT_DAYS,
} from '@/features/storefront/product/shop-policy';
import { SHOP_TITLE } from '@/features/storefront/shop/shop-metadata';
import { PRODUCT_SORTS } from '@/lib/catalog/product-query';
import { displayTitle } from '@/lib/catalog/variant';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  purchaseSentence,
  rialForStructuredData,
} from '@/lib/seo';
import { expect, test } from './support';

// Picked from the seed by what makes each one useful, never by index. The
// best-stocked product stays in stock however much the checkout specs spend.
const product = SEED_PRODUCTS.reduce((most, row) =>
  row.stock > most.stock ? row : most,
);
const member = SEED_PRODUCTS.find((row) => row.variantOfSku);
const shelf = [...SEED_CATEGORIES, ...SEED_SUBCATEGORIES].find(
  (category) => category.slug === product.categorySlug,
);
if (!member || !shelf) {
  throw new Error('The catalog seed needs a family and its categories.');
}

/** Every JSON-LD document on the page, parsed as a crawler parses it. */
const structuredData = async (page: Page) =>
  (
    await page.locator('script[type="application/ld+json"]').allTextContents()
  ).map((text) => JSON.parse(text) as Record<string, unknown>);

const canonical = (page: Page) => page.locator('link[rel="canonical"]');
const robots = (page: Page) => page.locator('meta[name="robots"]');
/** The share card's title, what Telegram and WhatsApp print for a link. */
const shareTitle = (page: Page) => page.locator('meta[property="og:title"]');

test('the sitemap lists products, family members and shelves, each by its canonical URL', async ({
  page,
}) => {
  const response = await page.request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const xml = await response.text();

  for (const path of [
    productPath(product.slug),
    // A member is a page of its own, though the shop grid lists only heads.
    productPath(member.slug),
    shopPath({ category: shelf.slug }),
    shopPath({ pet: product.petTypes[0] }),
  ]) {
    expect(xml).toContain(`<loc>${absoluteUrl(path)}</loc>`);
  }

  // The same string the product page names as its canonical.
  await page.goto(productPath(product.slug));
  await expect(canonical(page)).toHaveAttribute(
    'href',
    absoluteUrl(productPath(product.slug)),
  );
});

test('a product page gives Google its price in Rial, its stock, shipping, returns and breadcrumb', async ({
  page,
}) => {
  // In the HTML the server sends, not only in the page a browser builds: a
  // crawler that runs no script reads this response and nothing else.
  const html = await (await page.request.get(productPath(product.slug))).text();
  expect(html).toContain('"@type":"Product"');
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).toContain(
    `rel="canonical" href="${absoluteUrl(productPath(product.slug))}"`,
  );

  await page.goto(productPath(product.slug));
  const data = await structuredData(page);

  expect(data.find((doc) => doc['@type'] === 'Product')).toMatchObject({
    name: displayTitle(product),
    sku: product.sku,
    // A Google product category, never the Persian title Search Console
    // reported as an invalid value.
    category: {
      '@type': 'CategoryCode',
      inCodeSet:
        'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt',
      codeValue: expect.stringMatching(/^[245]$/),
    },
    offers: {
      url: absoluteUrl(productPath(product.slug)),
      priceCurrency: 'IRR',
      price: rialForStructuredData(product.price),
      availability: 'https://schema.org/InStock',
      // The fee is whatever the run's provinces charge, so only its shape.
      shippingDetails: {
        shippingDestination: { addressCountry: 'IR' },
        shippingRate: { currency: 'IRR' },
        deliveryTime: {
          handlingTime: {
            minValue: HANDLING_DAYS.min,
            maxValue: HANDLING_DAYS.max,
            unitCode: 'DAY',
          },
          transitTime: {
            minValue: TRANSIT_DAYS.min,
            maxValue: TRANSIT_DAYS.max,
            unitCode: 'DAY',
          },
        },
      },
      hasMerchantReturnPolicy: {
        applicableCountry: 'IR',
        merchantReturnDays: RETURN_DAYS,
        returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
      },
    },
  });
  // The same terms, where the shopper reads them.
  await expect(page.getByText(DELIVERY_NOTE)).toBeVisible();
  await expect(page.getByText(RETURN_NOTE)).toBeVisible();
  const trail = data.find((doc) => doc['@type'] === 'BreadcrumbList');
  expect(trail?.itemListElement).toEqual([
    expect.objectContaining({ position: 1, item: absoluteUrl(PATHS.HOME) }),
    expect.objectContaining({ position: 2, item: absoluteUrl(PATHS.SHOP) }),
    ...('parentSlug' in shelf
      ? [
          expect.objectContaining({
            item: absoluteUrl(shopPath({ category: shelf.parentSlug })),
          }),
        ]
      : []),
    expect.objectContaining({
      name: shelf.title,
      item: absoluteUrl(shopPath({ category: shelf.slug })),
    }),
    expect.objectContaining({
      name: displayTitle(product),
      item: absoluteUrl(productPath(product.slug)),
    }),
  ]);
});

test('the home page names the shop for Google', async ({ page }) => {
  await page.goto(PATHS.HOME);
  await expect(page).toHaveTitle(
    'پت‌شاپ اسموکی | فروشگاه آنلاین حیوانات خانگی',
  );
  const footer = page.getByRole('contentinfo');
  await expect(
    footer.getByText('پت‌شاپ اسموکی', { exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByText('Smokey Pet Shop', { exact: true }),
  ).toBeVisible();

  // Compared as URLs: Next writes the root without its slash and the sitemap
  // with it, and those are one URL (an empty path is `/`).
  const href = await canonical(page).getAttribute('href');
  expect(new URL(href ?? '').toString()).toBe(absoluteUrl(PATHS.HOME));
  await expect(shareTitle(page)).toHaveAttribute('content', await page.title());
  expect(await structuredData(page)).toContainEqual(
    expect.objectContaining({
      '@graph': expect.arrayContaining([
        expect.objectContaining({
          '@type': 'Organization',
          name: DEFAULT_SITE_NAME,
          alternateName: ['پت‌شاپ اسموکی', 'Smokey Pet Shop'],
          url: absoluteUrl(PATHS.HOME),
        }),
      ]),
    }),
  );
});

test('a category shelf names its category in the tab, the heading and the share card', async ({
  page,
}) => {
  await page.goto(shopPath({ category: shelf.slug }));
  const title = `${shelf.title} | ${DEFAULT_SITE_NAME}`;

  await expect(page).toHaveTitle(title);
  await expect(
    page.getByRole('heading', { level: 1, name: shelf.title }),
  ).toBeVisible();
  await expect(shareTitle(page)).toHaveAttribute('content', title);
  await expect(canonical(page)).toHaveAttribute(
    'href',
    absoluteUrl(shopPath({ category: shelf.slug })),
  );
});

test('a shelf breadcrumb leads back to the whole shop, its slashes hidden from screen readers', async ({
  page,
}) => {
  await page.goto(shopPath({ category: shelf.slug }));
  const toShop = page.locator('[data-umami-event="shop-breadcrumb-shop"]');
  const breadcrumb = page.locator('nav', { has: toShop });

  // The slashes only draw the trail: read aloud, each one is a stray "slash"
  // between two links. By text, since a role query cannot see hidden nodes.
  const slashes = breadcrumb.getByText('/', { exact: true });
  await expect(slashes).toHaveCount(2);
  for (const slash of await slashes.all()) {
    await expect(slash).toHaveAttribute('aria-hidden', 'true');
  }

  await toShop.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === PATHS.SHOP && url.search === '',
  );
  await expect(
    page.getByRole('heading', { level: 1, name: SHOP_TITLE }),
  ).toBeVisible();
});

test('a sorted view of a shelf stays out of the index, still titled and described by its shelf', async ({
  page,
}) => {
  const sorted = new URLSearchParams({
    category: shelf.slug,
    sort: PRODUCT_SORTS.PRICE_ASC,
  });
  await page.goto(`${PATHS.SHOP}?${sorted}`);

  await expect(page).toHaveTitle(`${shelf.title} | ${DEFAULT_SITE_NAME}`);
  // What a shared link's preview prints under that title.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    purchaseSentence(shelf.title),
  );
  await expect(robots(page)).toHaveAttribute('content', /noindex/);
  await expect(canonical(page)).toHaveCount(0);
});

test('a search, and a page past the end, stay out of the index with no canonical', async ({
  page,
}) => {
  const unlisted: Record<string, string>[] = [
    { q: product.title },
    { category: shelf.slug, page: '999' },
  ];
  for (const params of unlisted) {
    await page.goto(`${PATHS.SHOP}?${new URLSearchParams(params)}`);

    await expect(robots(page)).toHaveAttribute('content', /noindex/);
    await expect(canonical(page)).toHaveCount(0);
  }
});

test('an unknown category is not found, alone or with a pet', async ({
  page,
}) => {
  const unknown: Record<string, string>[] = [
    { category: 'no-such-category' },
    { category: 'no-such-category', pet: 'cat' },
  ];
  // Fetched rather than visited: the watch would count a 404 document.
  for (const params of unknown) {
    const response = await page.request.get(
      `${PATHS.SHOP}?${new URLSearchParams(params)}`,
    );
    expect(response.status()).toBe(404);
  }
});

test('the about page names itself, to Google and in its share card', async ({
  page,
}) => {
  await page.goto(PATHS.ABOUT);

  await expect(canonical(page)).toHaveAttribute(
    'href',
    absoluteUrl(PATHS.ABOUT),
  );
  await expect(shareTitle(page)).toHaveAttribute('content', await page.title());
});
