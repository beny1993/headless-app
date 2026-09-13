// Shared by the specs. Not a spec itself: Playwright only collects `*.spec.ts`
// here, plus `*.setup.ts` for the setup project.
import { expect, test as base, type Page } from '@playwright/test';
import { z } from 'zod';
import { SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { checkoutResultPath, productPath } from '@/lib/constant/paths';
import type { PaymentMethod } from '@/lib/orders/order-status';

export { expect };

/**
 * Every spec's `page`, watched for what QA looked for on each page by hand:
 * console errors, and requests to any host but the app's own (fonts are
 * self-hosted and analytics are off in this run, so another host is a leak).
 * Collected for the whole test and asserted at the end, so a failure lists
 * every problem at once.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, provide) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const offsiteRequests: string[] = [];
    page.on('request', (request) => {
      const { origin, protocol } = new URL(request.url());
      if (protocol.startsWith('http') && origin !== baseURL) {
        offsiteRequests.push(request.url());
      }
    });

    await provide(page);

    expect.soft(consoleErrors, 'console errors').toEqual([]);
    expect.soft(offsiteRequests, 'requests to other hosts').toEqual([]);
  },
});

/** Sessions saved by auth.setup.ts, one per role. Gitignored. */
export const CUSTOMER_STATE = 'e2e/.auth/customer.json';
export const ADMIN_STATE = 'e2e/.auth/admin.json';

// Read from the seed the web server runs before every suite, never restated.
// The seed also resets stock, so these hold at the start of every run.
const mostStocked = SEED_PRODUCTS.reduce((best, product) =>
  product.stock > best.stock ? product : best,
);
const soldOut = SEED_PRODUCTS.find((product) => product.stock === 0);
if (!soldOut) throw new Error('The catalog seed has no sold-out product.');

/** The best-stocked seeded product: the orders one run places never empty it. */
export const IN_STOCK_PRODUCT = productPath(mostStocked.slug);
/** The seeded product with nothing in stock. */
export const SOLD_OUT_PRODUCT = productPath(soldOut.slug);

/**
 * Adds one in-stock product to the cart and completes the checkout wizard,
 * delivering to the first seeded province. Returns once the order is
 * submitted, wherever that leads: the result page for cash on delivery, the
 * mock gateway for Zarinpal.
 */
export async function placeOrder(page: Page, payment: PaymentMethod) {
  await page.goto(IN_STOCK_PRODUCT);
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  await page.locator('[data-umami-event="cart-checkout-click"]').click();

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
