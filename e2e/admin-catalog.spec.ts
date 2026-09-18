import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { PET_TYPES } from '@/db/schema/catalog';
import { SEED_CATEGORIES, SEED_SUBCATEGORIES } from '@/db/seed/catalog-data';
import { formatPetTypes } from '@/features/storefront/shop/shop-query';
import { SUBCATEGORY_PREFIX } from '@/lib/catalog/category-tree';
import { SKU_SUFFIX_LENGTH, skuPreview } from '@/lib/catalog/sku';
import {
  API_PATHS,
  PROTECTED_PATHS,
  adminEditProductPath,
  adminNewProductPath,
  productPath,
  shopPath,
} from '@/lib/constant/paths';
import { DISCOUNT_TYPES } from '@/lib/discount/discount-code';
import { formatToman } from '@/lib/format';
import {
  ADMIN_STATE,
  PRODUCT_PHOTO,
  completeCheckout,
  expect,
  expectFailedRequest,
  openCheckout,
  resultOrderId,
  test,
} from './support';

test.use({ storageState: ADMIN_STATE });

// Both leave a row behind by design (products only soft-delete, codes only
// switch off), so they run at one width: one of each per run, not two.
test.skip(({ isMobile }) => isMobile, 'creates rows that are never deleted');

/** Unique per run, so a re-run never collides on a slug, SKU or code. */
const runId = () => randomInt(2 ** 40).toString(36);

/** A seeded sub-category, and a seeded top-level one that is not its parent. */
const SUB_CATEGORY = SEED_SUBCATEGORIES[0];
const EXTRA_CATEGORY = SEED_CATEGORIES.find(
  (category) => category.slug !== SUB_CATEGORY.parentSlug,
);
if (!EXTRA_CATEGORY) {
  throw new Error('The catalog seed has no category outside the sub’s parent.');
}

test('an admin adds a product with a photo, reprices it and takes it off the shop', async ({
  page,
}) => {
  const id = runId();
  const title = `محصول آزمایشی ${id}`;
  const slug = `e2e-${id}`;

  await page.goto(adminNewProductPath());
  await page.getByLabel('عنوان محصول', { exact: true }).fill(title);
  await page.getByLabel('نشانی یکتا (slug)', { exact: true }).fill(slug);
  // The SKU is generated from the slug on save; the field only previews it.
  const sku = page.getByLabel('کد کالا (SKU)', { exact: true });
  await expect(sku).toHaveJSProperty('readOnly', true);
  await expect(sku).toHaveValue(skuPreview(slug));
  // The category label carries a ZWNJ; matching its start avoids typing one.
  // Filed under a seeded sub-category, which the select offers under its
  // parent behind the «— » that stands in for the indent.
  await page
    .getByLabel(/^دسته/)
    .selectOption({ label: `${SUBCATEGORY_PREFIX}${SUB_CATEGORY.title}` });
  await page.getByLabel('قیمت (تومان)', { exact: true }).fill('150000');
  await page.getByLabel('موجودی', { exact: true }).fill('10');
  await page
    .locator('[data-umami-event="admin-panel-product-pet-cat"]')
    .click();
  await page
    .locator('[data-umami-event="admin-panel-product-pet-dog"]')
    .click();
  // One more category, alongside the main one. A seeded top-level one on
  // purpose: this product is never deleted, and the junction's restricting
  // foreign key would make a category the spec created undeletable for good.
  const extraSelect = page.locator(
    '[data-umami-event="admin-panel-product-category-extra-add"]',
  );
  // Picked by its title, so a second category carrying the same one — the
  // debris a failed integration run leaves behind — would silently weld *that*
  // row into this product for good. Say so here instead, where it is fixable.
  await expect(
    extraSelect.getByRole('option', {
      name: EXTRA_CATEGORY.title,
      exact: true,
    }),
  ).toHaveCount(1);
  await extraSelect.selectOption({ label: EXTRA_CATEGORY.title });
  // The select snaps back to its placeholder, so the chip is the only sign the
  // choice was taken — and it carries the plain title, without the prefix.
  await expect(
    page.locator('li', {
      has: page.locator(
        '[data-umami-event="admin-panel-product-category-extra-remove"]',
      ),
    }),
  ).toHaveText([EXTRA_CATEGORY.title]);
  await page.locator('input[type="file"]').setInputFiles(PRODUCT_PHOTO);

  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === API_PATHS.ADMIN_PRODUCTS,
    ),
    page.locator('[data-umami-event="admin-panel-product-save"]').click(),
  ]);
  const productId = z
    .object({ data: z.object({ id: z.string().min(1) }) })
    .parse(await created.json()).data.id;
  // The form returns to the list only once the photo upload after the save is done.
  await expect(page).toHaveURL(
    (url) => url.pathname === PROTECTED_PATHS.PRODUCTS,
  );

  await page.goto(productPath(slug));
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
  await expect(page.getByText(formatToman(150_000)).first()).toBeVisible();
  // Stored and served: an image that failed to load has no natural width.
  const photo = page.getByRole('img', { name: title });
  await expect
    .poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  // Both toggles were pressed, so «مناسب برای» names both animals — through
  // the one helper that wording comes from, never a literal.
  await page
    .locator('[data-umami-event="product-tab-select"]', {
      hasText: 'مشخصات',
    })
    .click();
  await expect(page.getByRole('region', { name: 'مشخصات' })).toContainText(
    formatPetTypes([PET_TYPES.CAT, PET_TYPES.DOG]),
  );

  await page.goto(adminEditProductPath(productId));
  // Saved as the slug's code plus a random suffix, and still not editable.
  await expect(sku).toHaveValue(
    new RegExp(`^${slug.toUpperCase()}-[A-Z0-9]{${SKU_SUFFIX_LENGTH}}$`),
  );
  await expect(sku).toHaveJSProperty('readOnly', true);
  await page.getByLabel('قیمت (تومان)', { exact: true }).fill('175000');
  await page.locator('[data-umami-event="admin-panel-product-save"]').click();
  await expect(page).toHaveURL(
    (url) => url.pathname === PROTECTED_PATHS.PRODUCTS,
  );
  await page.goto(productPath(slug));
  await expect(page.getByText(formatToman(175_000)).first()).toBeVisible();

  // Both shelves find it: the sub-category it is filed under, and the extra
  // one — which only the junction can answer for. Checked while it is still on
  // the shop, since the next step takes it off for good.
  for (const slugToFilter of [SUB_CATEGORY.slug, EXTRA_CATEGORY.slug]) {
    await page.goto(shopPath({ category: slugToFilter }));
    await expect(
      page.locator('[data-umami-event="product-card-open"]', {
        hasText: title,
      }),
    ).toHaveCount(1);
  }

  // Deactivated from the list, behind its confirm dialog.
  await page.goto(`${PROTECTED_PATHS.PRODUCTS}?q=${encodeURIComponent(id)}`);
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.startsWith(API_PATHS.ADMIN_PRODUCTS),
    ),
    page.getByRole('button', { name: `غیرفعال کردن ${title}` }).click(),
  ]);
  // A soft delete: the row stays, marked inactive, and stops offering it.
  const row = page.locator('tr', { hasText: title });
  await expect(row.getByText('غیرفعال', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `غیرفعال کردن ${title}` }),
  ).toHaveCount(0);
  // Fetched rather than visited: the watch would count a 404 document.
  expect((await page.request.get(productPath(slug))).status()).toBe(404);
});

test('an admin creates a discount code a shopper redeems, then switches it off', async ({
  page,
  shopper,
}) => {
  const code = `E2E${runId().toUpperCase()}`;

  await page.goto(PROTECTED_PATHS.DISCOUNTS);
  await page
    .locator('[data-umami-event="admin-panel-discount-code"]')
    .fill(code);
  await page
    .locator('[data-umami-event="admin-panel-discount-type"]')
    .selectOption(DISCOUNT_TYPES.PERCENT);
  await page
    .locator('[data-umami-event="admin-panel-discount-value"]')
    .fill('10');
  await page
    .locator('[data-umami-event="admin-panel-discount-create"]')
    .click();
  const row = page.locator('tr', { hasText: code });
  await expect(row.getByText('فعال', { exact: true })).toBeVisible();

  const applyCode = async () => {
    await shopper
      .locator('[data-umami-event="checkout-discount-code"]')
      .fill(code);
    await shopper
      .locator('[data-umami-event="checkout-discount-apply"]')
      .click();
  };

  await openCheckout(shopper);
  await applyCode();
  await expect(shopper.getByText('کد تخفیف اعمال شد.')).toBeVisible();
  await completeCheckout(shopper, 'cod');
  await resultOrderId(shopper);
  // The order the server priced carries the discount.
  await expect(
    shopper.getByRole('main').getByText('تخفیف', { exact: true }),
  ).toBeVisible();

  await row.locator('[data-umami-event="admin-panel-discount-toggle"]').click();
  await expect(row.getByText('غیرفعال', { exact: true })).toBeVisible();

  await openCheckout(shopper);
  expectFailedRequest(
    shopper,
    new RegExp(`^4\\d\\d \\S+${API_PATHS.CHECKOUT_PREVIEW}$`),
  );
  await applyCode();
  await expect(shopper.locator('[id$="-discount-error"]')).toBeVisible();
});
