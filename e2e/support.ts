// Shared by the specs. Not a spec itself: Playwright only collects `*.spec.ts`
// here, plus `*.setup.ts` for the setup project.
import type { Page } from '@playwright/test';
import { productPath } from '@/lib/constant/paths';
import type { PaymentMethod } from '@/lib/orders/order-status';

/** Sessions saved by auth.setup.ts, one per role. Gitignored. */
export const CUSTOMER_STATE = 'e2e/.auth/customer.json';
export const ADMIN_STATE = 'e2e/.auth/admin.json';

/**
 * A seeded product with 40 in stock. The seed that runs before every suite puts
 * that stock back, so the orders the specs place never run it dry.
 */
export const IN_STOCK_PRODUCT = productPath('applaws-cat-chicken-veg-treats');

/**
 * Adds one in-stock product to the cart and completes the checkout wizard with
 * a Tehran address. Returns once the order is submitted, wherever that leads:
 * the result page for cash on delivery, the mock gateway for Zarinpal.
 */
export async function placeOrder(page: Page, payment: PaymentMethod) {
  await page.goto(IN_STOCK_PRODUCT);
  await page.locator('[data-umami-event="product-add-to-cart"]').click();
  await page.locator('[data-umami-event="cart-checkout-click"]').click();

  // Step 1, the recipient, arrives prefilled from the account.
  await page.locator('[data-umami-event="checkout-step-next"]').click();

  await page
    .locator('[data-umami-event="checkout-province-change"]')
    .selectOption({ label: 'تهران' });
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
