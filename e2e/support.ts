// Shared by the specs. Not a spec itself: Playwright only collects `*.spec.ts`
// here, plus `*.setup.ts` for the setup project.
import { expect, test as base, type Page } from '@playwright/test';
import { z } from 'zod';
import { SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { LOW_STOCK_THRESHOLD } from '@/features/storefront/product/availability';
import { checkoutResultPath, productPath } from '@/lib/constant/paths';
import type { PaymentMethod } from '@/lib/orders/order-status';

export { expect };

/** Sessions saved by auth.setup.ts, one per role. Gitignored. */
export const CUSTOMER_STATE = 'e2e/.auth/customer.json';
export const ADMIN_STATE = 'e2e/.auth/admin.json';

/** Failed requests a spec has said it expects, per page, as `<status> <url>`. */
const expectedFailures = new WeakMap<Page, RegExp[]>();

/**
 * Declares a request this page is about to see fail on purpose — the 422 for a
 * discount code the spec knows is switched off — so the watch lets it through.
 */
export function expectFailedRequest(page: Page, pattern: RegExp) {
  expectedFailures.set(page, [...(expectedFailures.get(page) ?? []), pattern]);
}

/**
 * An uploaded image, straight or through the image optimizer. A dev database
 * keeps the uploads it was given while `.env` pointed at object storage, and
 * this run serves `/uploads` from the local driver, which has no file for
 * them: their thumbnails fail for the environment's reasons, not the app's.
 * The upload path itself is proven by the catalog spec, which uploads an image
 * and checks that it renders.
 */
const isUploadedImage = (url: URL) =>
  url.pathname.startsWith('/uploads/') ||
  (url.pathname === '/_next/image' &&
    (url.searchParams.get('url') ?? '').startsWith('/uploads/'));

/**
 * Watches a page for what QA looked for on each page by hand: console errors,
 * failed requests, and requests to any host but the app's own (fonts are
 * self-hosted and analytics are off in this run, so another host is a leak).
 * Returns the check, run once the test is done, so a failure lists every
 * problem at once.
 */
function watch(page: Page, baseURL: string | undefined) {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    // A failed request also logs "Failed to load resource", without its URL;
    // it is recorded from the response below instead, where the URL is known.
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource')
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const failedRequests: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      response.status() >= 400 &&
      url.origin === baseURL &&
      !isUploadedImage(url)
    ) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  const offsiteRequests: string[] = [];
  page.on('request', (request) => {
    const { origin, protocol } = new URL(request.url());
    if (protocol.startsWith('http') && origin !== baseURL) {
      offsiteRequests.push(request.url());
    }
  });

  return () => {
    const expected = expectedFailures.get(page) ?? [];
    expect.soft(consoleErrors, 'console errors').toEqual([]);
    expect
      .soft(
        failedRequests.filter(
          (failure) => !expected.some((pattern) => pattern.test(failure)),
        ),
        'failed requests',
      )
      .toEqual([]);
    expect.soft(offsiteRequests, 'requests to other hosts').toEqual([]);
  };
}

export const test = base.extend<{ shopper: Page }>({
  page: async ({ page, baseURL }, provide) => {
    const check = watch(page, baseURL);
    await provide(page);
    check();
  },
  /**
   * A second watched page, signed in as the customer in a browser context of
   * its own: for admin specs whose subject a shopper has to create or see.
   */
  shopper: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext({
      baseURL,
      storageState: CUSTOMER_STATE,
    });
    const shopper = await context.newPage();
    const check = watch(shopper, baseURL);
    await provide(shopper);
    check();
    await context.close();
  },
});

// Read from the seed the web server runs before every suite, never restated.
// The seed also resets stock, so these hold at the start of every run.
const mostStocked = SEED_PRODUCTS.reduce((best, product) =>
  product.stock > best.stock ? product : best,
);
const soldOut = SEED_PRODUCTS.find((product) => product.stock === 0);
const runningOut = SEED_PRODUCTS.find(
  (product) => product.stock > 1 && product.stock <= LOW_STOCK_THRESHOLD,
);
if (!soldOut || !runningOut) {
  throw new Error('The catalog seed needs a sold-out and a low-stock product.');
}

/** The best-stocked seeded product: the orders one run places never empty it. */
export const IN_STOCK_PRODUCT = productPath(mostStocked.slug);
/** The seeded product with nothing in stock. */
export const SOLD_OUT_PRODUCT = productPath(soldOut.slug);
/** A seeded product the page says is running out, and how many are left. */
export const LOW_STOCK_PRODUCT = {
  path: productPath(runningOut.slug),
  stock: runningOut.stock,
};
/** A seeded product photo, bundled in public/, to upload as a new product's. */
export const PRODUCT_PHOTO = `public/${mostStocked.imageKeys[0]}`;

/** Puts one of `product` in the cart and opens checkout from the drawer. */
export async function openCheckout(page: Page, product = IN_STOCK_PRODUCT) {
  await page.goto(product);
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  await page.locator('[data-umami-event="cart-checkout-click"]').click();
}

/**
 * Walks the open checkout wizard, delivering to the first seeded province,
 * and submits it. Returns wherever that leads: the result page for cash on
 * delivery, the mock gateway for Zarinpal.
 */
export async function completeCheckout(page: Page, payment: PaymentMethod) {
  // Step 1, the recipient, arrives prefilled from the account.
  await page.locator('[data-umami-event="checkout-step-next"]').click();

  await page
    .locator('[data-umami-event="checkout-province-change"]')
    .selectOption({ label: SEED_PROVINCES[0].name });
  await page.locator('[data-umami-event="checkout-city"]').fill('تهران');
  await page
    .locator('[data-umami-event="checkout-address-line"]')
    .fill('خیابان آزادی، کوچه بهار، پلاک ۱۲');
  await page
    .locator('[data-umami-event="checkout-postal-code"]')
    .fill('1234567890');
  await page.locator('[data-umami-event="checkout-step-next"]').click();

  await page
    .locator(`[data-umami-event="checkout-payment-${payment}"]`)
    .check();
  await page.locator('[data-umami-event="checkout-submit-order"]').click();
}

/** Adds one of `product` to the cart and checks out, paying with `payment`. */
export async function placeOrder(
  page: Page,
  payment: PaymentMethod,
  product = IN_STOCK_PRODUCT,
) {
  await openCheckout(page, product);
  await completeCheckout(page, payment);
}

/**
 * The id of the order a checkout just created, read off the result page's URL.
 * Parsed as a uuid, so a changed URL fails here rather than as a confusing
 * locator timeout further on.
 */
export async function resultOrderId(page: Page) {
  const prefix = checkoutResultPath('');
  await page.waitForURL((url) => url.pathname.startsWith(prefix));
  return z.uuid().parse(new URL(page.url()).pathname.slice(prefix.length));
}
