import { randomInt } from 'node:crypto';
import type { Page, Response } from '@playwright/test';
import { z } from 'zod';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { API_PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { ADMIN_STATE, expect, expectFailedRequest, test } from './support';

test.use({ storageState: ADMIN_STATE });

/** Unique per run, so a re-run never collides on a slug. */
const runId = () => randomInt(2 ** 40).toString(36);

const categoryCall = (method: string) => (response: Response) =>
  response.request().method() === method &&
  new URL(response.url()).pathname.startsWith(API_PATHS.ADMIN_CATEGORIES);

/** The table row whose slug cell reads exactly `slug`. */
const rowFor = (page: Page, slug: string) =>
  page.locator('tr', {
    has: page.getByRole('cell', { name: slug, exact: true }),
  });

/**
 * Fills the create form and submits it, optionally under a parent. Returns the
 * new category's id — the value the parent select of the next one takes.
 */
async function createCategory(
  page: Page,
  title: string,
  slug: string,
  parentId?: string,
) {
  await page
    .locator('[data-umami-event="admin-panel-categories-title"]')
    .fill(title);
  await page
    .locator('[data-umami-event="admin-panel-categories-slug"]')
    .fill(slug);
  if (parentId) {
    await page
      .locator('[data-umami-event="admin-panel-categories-parent"]')
      .selectOption(parentId);
  }
  const [created] = await Promise.all([
    page.waitForResponse(categoryCall('POST')),
    page.locator('[data-umami-event="admin-panel-categories-create"]').click(),
  ]);
  await expect(rowFor(page, slug)).toContainText(title);

  return z
    .object({ data: z.object({ id: z.uuid() }) })
    .parse(await created.json()).data.id;
}

/** Deletes a category through its row, past the confirm dialog. */
async function deleteCategory(page: Page, slug: string) {
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([
    page.waitForResponse(categoryCall('DELETE')),
    rowFor(page, slug)
      .locator('[data-umami-event="admin-panel-categories-delete"]')
      .click(),
  ]);
  await expect(rowFor(page, slug)).toHaveCount(0);
}

/**
 * Teardown that survives a spec which failed before it finished setting up.
 * A row that was never created is nothing to clean up; one that was has to go,
 * because `categories.parent_id` restricts and the next run picks its category
 * by title. Reloads first: after a failed assertion the page can be anywhere.
 */
async function removeIfPresent(page: Page, slug: string) {
  await page.goto(PROTECTED_PATHS.CATEGORIES);
  if ((await rowFor(page, slug).count()) === 0) return;
  await deleteCategory(page, slug);
}

test('an admin creates a category, renames it and deletes it', async ({
  page,
}) => {
  const id = runId();
  const title = `دسته آزمایشی ${id}`;
  const renamed = `دسته تازه ${id}`;
  const slug = `e2e-category-${id}`;

  await page.goto(PROTECTED_PATHS.CATEGORIES);
  try {
    await createCategory(page, title, slug);

    // Renamed in place: the row turns into its own fields, then saves.
    await rowFor(page, slug)
      .locator('[data-umami-event="admin-panel-categories-edit"]')
      .click();
    const editing = page.locator('tr', {
      has: page.locator(
        '[data-umami-event="admin-panel-categories-row-title"]',
      ),
    });
    await editing
      .locator('[data-umami-event="admin-panel-categories-row-title"]')
      .fill(renamed);
    await Promise.all([
      page.waitForResponse(categoryCall('PUT')),
      editing
        .locator('[data-umami-event="admin-panel-categories-save"]')
        .click(),
    ]);
    await expect(rowFor(page, slug)).toContainText(renamed);

    // No product uses it, so it deletes outright.
    await deleteCategory(page, slug);
  } finally {
    // The delete above is the assertion; this is the safety net for a failure
    // anywhere before it, which would otherwise leave the row in the shared
    // dev database for the next run to trip over.
    await removeIfPresent(page, slug);
  }
});

test('an admin nests a sub-category, and the parent waits for it to go first', async ({
  page,
}) => {
  const id = runId();
  const parentTitle = `دسته مادر ${id}`;
  const parentSlug = `e2e-parent-${id}`;
  const subSlug = `e2e-sub-${id}`;
  // Deleting the parent while its sub-category is still there is the 409 this
  // spec is here to see.
  expectFailedRequest(
    page,
    new RegExp(`^409 .*${API_PATHS.ADMIN_CATEGORIES}/`),
  );

  await page.goto(PROTECTED_PATHS.CATEGORIES);

  // The creates are inside the `try` as well, not only the assertions: the
  // second one can fail on its own, and it used to leave the parent behind —
  // an undeletable row in the shared dev database, since the next run's «pick
  // a category by its title» would then have two to choose from. Child first
  // in the teardown; the parent's own foreign key refuses the other order.
  try {
    const parentId = await createCategory(page, parentTitle, parentSlug);
    await createCategory(page, `زیردسته ${id}`, subSlug, parentId);

    // The nesting is announced, not merely indented: the sub-row's title cell
    // opens with the parent's name for a screen reader, and that is the only
    // place the parent's title turns up in this row.
    await expect(rowFor(page, subSlug)).toContainText(parentTitle);

    page.once('dialog', (dialog) => dialog.accept());
    const [refused] = await Promise.all([
      page.waitForResponse(categoryCall('DELETE')),
      rowFor(page, parentSlug)
        .locator('[data-umami-event="admin-panel-categories-delete"]')
        .click(),
    ]);
    expect(refused.status()).toBe(409);

    // The refusal counts what blocks it, through src/lib/format.ts, and
    // reaches the admin as the error toast the shipped delete flow already
    // uses.
    const { message } = z
      .object({ message: z.string().min(1) })
      .parse(await refused.json());
    expect(message).toContain(`${formatNumber(1)} زیردسته`);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]'),
    ).toContainText(message);
    await expect(rowFor(page, parentSlug)).toBeVisible();
  } finally {
    // Emptied, the parent goes — so this spec leaves no row behind and runs at
    // both widths. Tolerant of a run that never got as far as creating them.
    await removeIfPresent(page, subSlug);
    await removeIfPresent(page, parentSlug);
  }
});

test('a category that still has products stays, and a toast says why', async ({
  page,
}) => {
  // A seeded category the seeded products are filed under, never restated.
  const inUse = SEED_CATEGORIES.find((category) =>
    SEED_PRODUCTS.some((product) => product.categorySlug === category.slug),
  );
  if (!inUse)
    throw new Error('The catalog seed files no product in a category.');
  // The refusal is the 409 this spec is here to see.
  expectFailedRequest(
    page,
    new RegExp(`^409 .*${API_PATHS.ADMIN_CATEGORIES}/`),
  );

  await page.goto(PROTECTED_PATHS.CATEGORIES);
  const row = rowFor(page, inUse.slug);
  page.once('dialog', (dialog) => dialog.accept());
  const [refused] = await Promise.all([
    page.waitForResponse(categoryCall('DELETE')),
    row.locator('[data-umami-event="admin-panel-categories-delete"]').click(),
  ]);
  expect(refused.status()).toBe(409);

  // The server's own reason, as an error toast, and the row is still listed.
  const { message } = z
    .object({ message: z.string().min(1) })
    .parse(await refused.json());
  await expect(
    page.locator('[data-sonner-toast][data-type="error"]'),
  ).toContainText(message);
  await expect(row).toBeVisible();
});
