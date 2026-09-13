import { expect, test } from '@playwright/test';
import { PATHS } from '@/lib/constant/paths';
import { IN_STOCK_PRODUCT } from './support';

test('a shopper browses from home to a product and into the cart', async ({
  page,
  baseURL,
}) => {
  // Collected over the whole walk and asserted at the end, so a failure lists
  // every problem instead of stopping at the first.
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  // Local-first: fonts are self-hosted and analytics are off in this run, so a
  // request to any other host is a leak — a Google font, a CDN, a baked-in URL.
  const offsiteRequests: string[] = [];
  page.on('request', (request) => {
    const { origin, protocol } = new URL(request.url());
    if (protocol.startsWith('http') && origin !== baseURL) {
      offsiteRequests.push(request.url());
    }
  });

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

  // The first card can be the seeded out-of-stock product, so the cart is
  // exercised on one that always has stock.
  await page.goto(IN_STOCK_PRODUCT);
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  await page.locator('[data-umami-event="product-add-to-cart"]').click();

  const drawer = page.getByRole('dialog', { name: 'سبد خرید' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(title);

  expect.soft(consoleErrors, 'console errors').toEqual([]);
  expect.soft(offsiteRequests, 'requests to other hosts').toEqual([]);
});
