// Shared by the specs. Not a spec itself: Playwright only collects `*.spec.ts`
// here, plus `*.setup.ts` for the setup project.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { z } from 'zod';
import { SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { LOW_STOCK_THRESHOLD } from '@/features/storefront/product/availability';
import { displayTitle } from '@/lib/catalog/variant';
import {
  API_PATHS,
  apiAdminOrderTransitionsPath,
  checkoutResultPath,
  productPath,
} from '@/lib/constant/paths';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/orders/order-status';

export { expect };

/** Sessions saved by auth.setup.ts, one per role. Gitignored. */
export const CUSTOMER_STATE = 'e2e/.auth/customer.json';
export const ADMIN_STATE = 'e2e/.auth/admin.json';
/** The customer's phone as they typed it (`0999…`), saved beside their session. */
export const CUSTOMER_PHONE = 'e2e/.auth/customer-phone.txt';

/** The phone the customer session signed in with, in local `09…` form. */
export const customerPhone = () => readFileSync(CUSTOMER_PHONE, 'utf8').trim();

/** Unique per run, so a re-run never collides on a slug, SKU, code or name. */
export const runId = () => randomInt(2 ** 40).toString(36);

/** A `waitForResponse` matcher: a `method` request to `path` or below it. */
export const apiCall = (method: string, path: string) => (response: Response) =>
  response.request().method() === method &&
  new URL(response.url()).pathname.startsWith(path);

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
 * The storage key behind a rendered `src`. `next/image` wraps the real one as
 * `/_next/image?url=%2Fuploads%2F…`, so nothing string-matches the raw src:
 * the inner URL comes out of the query, `URLSearchParams` having decoded it
 * already, and a plain one is the pathname as it stands. Either way the
 * leading slash goes. The ONE place that knows this shape — a Next change to
 * it breaks here and is fixed here.
 *
 * The pathname is NOT decoded: this runs inside the response listener below,
 * and `decodeURIComponent` throws `URIError` on a stray `%` — which would
 * raise inside an event handler and lose the failed request the watch exists
 * to record, instead of reporting it.
 */
export const unwrapImageSrc = (url: URL): string =>
  (url.pathname === '/_next/image'
    ? (url.searchParams.get('url') ?? '')
    : url.pathname
  ).replace(/^\//, '');

/** The storage key an `<img>` is actually showing. */
export async function renderedKey(img: Locator): Promise<string> {
  const src = await img.getAttribute('src');
  return unwrapImageSrc(new URL(src ?? '', 'http://localhost'));
}

/** An image the browser managed to decode — a broken one has no natural width. */
export async function expectRendered(img: Locator) {
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

/**
 * How many lines a block of text wraps onto: its height over its line height,
 * which `getComputedStyle` reads back in pixels whenever one is set, as
 * Tailwind's text sizes do (`normal` reads back as the word, and the count as
 * NaN). For copy that must read as a line, not squeezed into a column beside a
 * button at 375px. Read it through `expect.poll`: the self-hosted font can
 * still swap in and reflow the text.
 */
export function lineCount(block: Locator): Promise<number> {
  return block.evaluate((element) =>
    Math.round(
      element.getBoundingClientRect().height /
        parseFloat(getComputedStyle(element).lineHeight),
    ),
  );
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
  unwrapImageSrc(url).startsWith('uploads/');

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
const soldOut = SEED_PRODUCTS.find(
  (product) => product.stock === 0 && !product.variantLabel,
);
const runningOut = SEED_PRODUCTS.find(
  (product) => product.stock > 1 && product.stock <= LOW_STOCK_THRESHOLD,
);
if (!soldOut || !runningOut) {
  throw new Error('The catalog seed needs a sold-out and a low-stock product.');
}

/** The best-stocked seeded product: the orders one run places never empty it. */
export const IN_STOCK_PRODUCT = productPath(mostStocked.slug);
/** How the admin names it: `displayTitle`, the one wording every admin list uses. */
export const IN_STOCK_TITLE = displayTitle(mostStocked);
/** The seeded product with nothing in stock. */
export const SOLD_OUT_PRODUCT = productPath(soldOut.slug);
/** A seeded product the page says is running out, and how many are left. */
export const LOW_STOCK_PRODUCT = {
  path: productPath(runningOut.slug),
  stock: runningOut.stock,
};
/**
 * The one seeded product with more than one photo, and how many it has. The
 * only multi-photo product a spec can reach without building one through the
 * admin panel — which is what lets the gallery be walked at 375px, where the
 * admin spec (desktop-only by suite policy) never goes.
 */
const gallery = SEED_PRODUCTS.find((product) => product.imageKeys.length > 1);
if (!gallery) {
  throw new Error('The catalog seed needs one product with a gallery.');
}
export const GALLERY_PRODUCT = {
  path: productPath(gallery.slug),
  photoCount: gallery.imageKeys.length,
};

/** A seeded product photo, bundled in public/, to upload as a new product's. */
export const PRODUCT_PHOTO = `public/${mostStocked.imageKeys[0]}`;

/**
 * Two more visibly different bundled photos, so a gallery spec can tell which
 * of a product's photos is on screen. Read from the seed rather than named
 * here — they only have to be three different files.
 *
 * Three and not two: with two photos the only thumbnail a shopper can click is
 * the adjacent one, and a jump of one slide is the single case that cannot
 * catch `scroll-snap-stop: always` refusing to pass an intervening snap point.
 * That is exactly how a two-photo spec went green over a gallery whose thumbs
 * landed one photo short of wherever they were aimed.
 */
const otherPhotoKeys = [
  ...new Set(SEED_PRODUCTS.map((product) => product.imageKeys[0])),
].filter((key) => key && key !== mostStocked.imageKeys[0]);
if (otherPhotoKeys.length < 2) {
  throw new Error(
    'The catalog seed needs three products with different photos.',
  );
}
export const SECOND_PRODUCT_PHOTO = `public/${otherPhotoKeys[0]}`;
export const THIRD_PRODUCT_PHOTO = `public/${otherPhotoKeys[1]}`;

/** Puts one of `product` in the cart and opens checkout from the drawer. */
export async function openCheckout(page: Page, product = IN_STOCK_PRODUCT) {
  await page.goto(product);
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  await page.locator('[data-umami-event="cart-checkout-click"]').click();
}

/**
 * Step 1 of the open checkout wizard, the recipient. The phone arrives
 * prefilled from the account, the name does not — a new account has none.
 */
export async function passRecipientStep(page: Page) {
  await page
    .locator('[data-umami-event="checkout-recipient-name"]')
    .fill('سارا محمدی');
  await page.locator('[data-umami-event="checkout-step-next"]').click();
}

/**
 * Walks the open checkout wizard to its payment step, delivering to the first
 * seeded province — for a spec that reads that step before submitting.
 */
export async function reachPayment(page: Page) {
  await passRecipientStep(page);

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
}

/**
 * Attaches the transfer's screenshot on the checkout's payment step, card to
 * card chosen — the product photo the catalog spec uploads, a JPEG — and waits
 * until the form has taken it: «ثبت سفارش» is locked until then.
 */
export async function attachReceipt(page: Page) {
  await page
    .locator('[data-umami-event="checkout-receipt-file"]')
    .setInputFiles(PRODUCT_PHOTO);
  await expect(page.getByText('یک تصویر انتخاب شد')).toBeVisible();
}

/**
 * Walks the open checkout wizard and submits it — card to card with its
 * screenshot attached. Returns wherever that leads: the result page for card
 * to card, the mock gateway for Zarinpal.
 */
export async function completeCheckout(page: Page, payment: PaymentMethod) {
  await reachPayment(page);
  await page
    .locator(`[data-umami-event="checkout-payment-${payment}"]`)
    .check();
  if (payment === PAYMENT_METHODS.COD) await attachReceipt(page);
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

/**
 * Cancels a card-to-card order a spec placed only to have one, through the
 * admin API (`admin` is a page signed in as the admin), with the reason every
 * admin cancel needs. Its screenshot accepted it at checkout, so it is not
 * open against the customer's cap: it is cancelled for hygiene, and for the
 * stock the specs read, which the cancel puts back. Call it in a `finally`.
 */
export async function closeOrder(admin: Page, orderId: string) {
  await cancelOrder(admin.request, orderId);
}

const cancelOrder = async (admin: APIRequestContext, orderId: string) => {
  const response = await admin.post(apiAdminOrderTransitionsPath(orderId), {
    data: {
      to: ORDER_STATUSES.CANCELLED,
      reason: 'بسته شده در آزمون خودکار',
    },
  });
  expect(response.status(), 'closing the order').toBe(200);
};

/**
 * For the `afterEach` of a test that is meant to move its order on (ship,
 * cancel): closes the order only if it is STILL waiting for its receipt — as
 * it is when its screenshot failed to store, or the test cut the upload and
 * failed before cancelling. A waiting order is OPEN: it counts against its
 * customer's open-order cap (`MAX_OPEN_ORDERS`, five). An order the test did
 * move on — accepted, shipped, already cancelled — is left exactly as it is.
 * `admin` is a request context signed in as the admin.
 */
export async function closeIfStillWaiting(
  admin: APIRequestContext,
  orderId: string,
) {
  const response = await admin.get(`${API_PATHS.ADMIN_ORDERS}/${orderId}`);
  expect(response.status(), 'reading the order to close').toBe(200);
  const { data } = z
    .object({ data: z.object({ status: z.string() }) })
    .parse(await response.json());
  if (data.status === ORDER_STATUSES.AWAITING_RECEIPT) {
    await cancelOrder(admin, orderId);
  }
}
