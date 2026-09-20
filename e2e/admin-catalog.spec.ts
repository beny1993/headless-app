import { formatPetTypes } from '@/lib/catalog/product-query';
import { randomInt } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { z } from 'zod';
import { PET_TYPES } from '@/db/schema/catalog';
import { SEED_CATEGORIES, SEED_SUBCATEGORIES } from '@/db/seed/catalog-data';
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
import { formatNumber, formatToman } from '@/lib/format';
import {
  ADMIN_STATE,
  PRODUCT_PHOTO,
  SECOND_PRODUCT_PHOTO,
  THIRD_PRODUCT_PHOTO,
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

/**
 * The storage key an `<img>` is actually showing. `next/image` wraps it as
 * `/_next/image?url=%2Fuploads%2F…`, so the raw `src` is never string-matched:
 * the inner URL is read out of the query and unwrapped back to a key.
 */
async function renderedKey(img: Locator): Promise<string> {
  const src = await img.getAttribute('src');
  const url = new URL(src ?? '', 'http://localhost');
  const inner = url.searchParams.get('url') ?? url.pathname;
  return decodeURIComponent(inner).replace(/^\//, '');
}

/**
 * The `<img>` in the admin form's nth photo tile — a list item that holds a
 * remove button is a photo tile and nothing else is.
 */
function tileImage(page: Page, index: number): Locator {
  return page
    .locator('li', {
      has: page.locator(
        '[data-umami-event="admin-panel-product-image-remove"]',
      ),
    })
    .nth(index)
    .locator('img');
}

/** An image the browser managed to decode — a broken one has no natural width. */
async function expectRendered(img: Locator) {
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

test('an admin adds a product with photos, reorders them, reprices it and takes it off the shop', async ({
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
  // Three photos in one pick. Selected by event name, not `input[type=file]`:
  // the multi-photo field renders one input per add tile, so the bare tag
  // selector is ambiguous the moment a photo is on the form.
  //
  // Three rather than two so the thumbnail strip below has a NON-adjacent
  // thumb to click. Two photos can only ever test a one-slide jump, which is
  // the one case `scroll-snap-stop: always` lets through.
  await page
    .locator('[data-umami-event="admin-panel-product-image-add"]')
    .setInputFiles([PRODUCT_PHOTO, SECOND_PRODUCT_PHOTO, THIRD_PRODUCT_PHOTO]);
  await expect(
    page.locator('[data-umami-event="admin-panel-product-image-reorder"]'),
  ).toHaveCount(3);

  // Every photo goes up in its own request after the product row saves, so the
  // stored keys arrive in gallery order — which is how the assertions below
  // know which file is on screen.
  const uploadedKeys: string[] = [];
  page.on('response', async (response) => {
    if (response.request().method() !== 'POST') return;
    if (!new URL(response.url()).pathname.endsWith('/images')) return;
    const parsed = z
      .object({ data: z.object({ objectKey: z.string().min(1) }) })
      .safeParse(await response.json().catch(() => null));
    if (parsed.success) uploadedKeys.push(parsed.data.data.objectKey);
  });

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
  // `exact`, because the second slide's alt reads «تصویر ۲ از {title}» and so
  // contains the title — a substring match resolves to every slide.
  const photo = page.getByRole('img', { name: title, exact: true });
  await expectRendered(photo);
  // Three photos, so the strip appears. `seed-catalog` re-runs `setImages`
  // before every run and resets each seeded gallery to what the seed data
  // lists, so the only galleries in the suite are this one and the single
  // seeded product that carries three photos of its own — which is what the
  // storefront spec walks at phone width, where this spec never goes.
  await expect.poll(() => uploadedKeys.length).toBe(3);
  await expect(
    page.locator('[data-umami-event="product-gallery-thumb-select"]'),
  ).toHaveCount(3);
  // The later slides are numbered rather than repeating the title five times.
  await expect(
    page.getByAltText(`تصویر ${formatNumber(2)} از ${title}`),
  ).toHaveCount(1);
  // The cover is the first photo the admin arranged, not whichever uploaded
  // fastest — which is what the reorder below then changes.
  expect(await renderedKey(photo)).toBe(uploadedKeys[0]);
  // Clicking a thumb in a real engine: the only place the RTL scroll maths and
  // the IntersectionObserver both actually run. The component test stubs the
  // observer and spies on `scrollBy`, so neither the sign of the visual-rect
  // delta nor whether the observer fires at all is proven anywhere else.
  // `toHaveAttribute` retries, which absorbs the smooth-scroll ripple through
  // the intermediate slides.
  const thumbs = page.locator(
    '[data-umami-event="product-gallery-thumb-select"]',
  );
  // The LAST thumb, not the next one: two slides away, so the jump has to pass
  // a snap point to arrive. `scroll-snap-stop: always` refuses to let any
  // scroll pass one — programmatic or not, animated or not — so the gallery
  // used to stop on the middle photo and stay there, and only a jump of two or
  // more can see it.
  await thumbs.nth(2).click();
  await expect(thumbs.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(thumbs.nth(1)).toHaveAttribute('aria-pressed', 'false');
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

  // Drag the second photo onto the first. This is the only place the pointer
  // path runs at all: happy-dom reports zero-size rects, so a component test
  // can reach the keyboard fallback and nothing else.
  const handles = page.locator(
    '[data-umami-event="admin-panel-product-image-reorder"]',
  );
  await expect(handles).toHaveCount(3);
  expect(await renderedKey(tileImage(page, 0))).toBe(uploadedKeys[0]);
  const from = await handles.nth(1).boundingBox();
  const onto = await handles.nth(0).boundingBox();
  if (!from || !onto) throw new Error('a photo handle has no box to drag');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  // Asserted on which FILE is in the first tile, never on the caption: the
  // captions are positional, so «عکس اصلی» reads the same before and after a
  // drag that did nothing at all.
  await expect
    .poll(() => renderedKey(tileImage(page, 0)))
    .toBe(uploadedKeys[1]);

  // Drag the other way — toward the END of the list. This is the direction
  // that used to die after a single cell: React reorders a keyed list with
  // `insertBefore`, which drops pointer capture on the element being moved and
  // fires neither `pointerup` nor `pointercancel`, so a handle-bound gesture
  // stopped receiving moves. `from < to` moves the dragged tile, which is why
  // only this direction broke, and why the drag above passed throughout.
  // `scrollIntoViewIfNeeded` because `boundingBox()` does not scroll.
  await handles.nth(0).scrollIntoViewIfNeeded();
  const startBox = await handles.nth(0).boundingBox();
  const endBox = await handles.nth(2).boundingBox();
  if (!startBox || !endBox)
    throw new Error('a photo handle has no box to drag');
  await page.mouse.move(
    startBox.x + startBox.width / 2,
    startBox.y + startBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    endBox.x + endBox.width / 2,
    endBox.y + endBox.height / 2,
    { steps: 12 },
  );
  // Present mid-drag, so the assertion after the release means something. A
  // count of zero on its own passes just as well when the marker was never
  // rendered at all.
  await expect(page.locator('[data-photo-dragging]')).toHaveCount(1);
  await page.mouse.up();
  // It travelled the whole way, not one cell: the photo that led is now last.
  await expect
    .poll(() => renderedKey(tileImage(page, 2)))
    .toBe(uploadedKeys[1]);
  // And the gesture really ended — a tile left mid-drag stays marked. Asserted
  // on the attribute, not the Tailwind class: a count of zero against a
  // styling class passes the day the class is renamed.
  await expect(page.locator('[data-photo-dragging]')).toHaveCount(0);

  // The keyboard path, which had no E2E coverage at all. Moving the focused
  // handle also moves the element holding focus, and a browser drops focus to
  // `<body>` when that happens, so the assertion is where focus ends up.
  const firstHandle = handles.nth(0);
  await firstHandle.focus();
  // RTL: ArrowLeft moves toward the end of the list.
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => renderedKey(tileImage(page, 1)))
    .toBe(uploadedKeys[0]);
  await expect(handles.nth(1)).toBeFocused();

  // Back the other way, twice, which both covers ArrowRight — the direction
  // that always kept focus, so the pair proves the two are now symmetric — and
  // restores the cover the rest of this spec is written against.
  await handles.nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(handles.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(handles.nth(0)).toBeFocused();
  await expect
    .poll(() => renderedKey(tileImage(page, 0)))
    .toBe(uploadedKeys[1]);

  await page.getByLabel('قیمت (تومان)', { exact: true }).fill('175000');
  await page.locator('[data-umami-event="admin-panel-product-save"]').click();
  await expect(page).toHaveURL(
    (url) => url.pathname === PROTECTED_PATHS.PRODUCTS,
  );
  await page.goto(productPath(slug));
  await expect(page.getByText(formatToman(175_000)).first()).toBeVisible();
  // The reorder reached the shopper: the opening image is the other photo now.
  // Nothing was uploaded this time round, so the save carried the order alone.
  expect(
    await renderedKey(page.getByRole('img', { name: title, exact: true })),
  ).toBe(uploadedKeys[1]);
  // And a reorder deleted nothing: both files still serve. Probed through the
  // uploads route rather than an `<img>` — `next/image` caches what it
  // optimized, so a deleted file goes on rendering from `.next/cache` and an
  // on-page check passes against the very bug this is here to catch.
  for (const key of uploadedKeys) {
    expect((await page.request.get(`/${key}`)).status()).toBe(200);
  }

  // Now remove, which is the only thing that deletes a file. Two of the three
  // go, so the end state is still the single-photo product the assertions
  // below are written against — and two dropped keys prove the deletion set is
  // «every one the admin removed», not «the one».
  await page.goto(adminEditProductPath(productId));
  // The first removal is driven from the keyboard, not the mouse: focus the
  // button and press Enter. Nothing overrides a plain `<button>`'s native
  // activation, but «nothing overrides it» is a claim no test made — the unit
  // harness cannot deliver a real key-to-click for any button, so a real
  // engine is the only place it can be shown at all. Focus then has to land
  // somewhere usable, which is the other half of the same keyboard path.
  const removeThird = page.getByRole('button', {
    name: `حذف عکس ${formatNumber(3)}`,
  });
  await removeThird.focus();
  await page.keyboard.press('Enter');
  const removeSecond = page.getByRole('button', {
    name: `حذف عکس ${formatNumber(2)}`,
  });
  await expect(removeSecond).toBeFocused();
  await removeSecond.click();
  await expect(handles).toHaveCount(1);
  await page.locator('[data-umami-event="admin-panel-product-save"]').click();
  await expect(page).toHaveURL(
    (url) => url.pathname === PROTECTED_PATHS.PRODUCTS,
  );

  await page.goto(productPath(slug));
  const kept = page.getByRole('img', { name: title, exact: true });
  expect(await renderedKey(kept)).toBe(uploadedKeys[1]);
  // The photo that stayed still has its file — the defect this guards against
  // deleted every one of them whenever any one of them went.
  await expectRendered(kept);
  // One photo left, so no strip: a one-item picker cannot do anything.
  await expect(
    page.locator('[data-umami-event="product-gallery-thumb-select"]'),
  ).toHaveCount(0);
  // The removed photo's file is gone and the kept one's is not — the pair is
  // the point, since «delete everything» also satisfies the first half.
  // Fetched rather than visited: the watch would count a 404 document as a
  // failed request, and the optimizer would serve either from its cache.
  expect((await page.request.get(`/${uploadedKeys[0]}`)).status()).toBe(404);
  expect((await page.request.get(`/${uploadedKeys[2]}`)).status()).toBe(404);
  expect((await page.request.get(`/${uploadedKeys[1]}`)).status()).toBe(200);

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
