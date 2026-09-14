import { PATHS } from '@/lib/constant/paths';
import { IN_STOCK_PRODUCT, SOLD_OUT_PRODUCT, expect, test } from './support';

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
  await drawer.locator('[data-umami-event="cart-line-remove"]').click();
  await expect(drawer).toContainText('سبد خرید شما خالی است');
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
