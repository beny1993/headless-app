import { randomInt } from 'node:crypto';
import type { Page, Response } from '@playwright/test';
import { z } from 'zod';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { API_PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
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

test('an admin creates a category, renames it and deletes it', async ({
  page,
}) => {
  const id = runId();
  const title = `دسته آزمایشی ${id}`;
  const renamed = `دسته تازه ${id}`;
  const slug = `e2e-category-${id}`;

  await page.goto(PROTECTED_PATHS.CATEGORIES);
  await page
    .locator('[data-umami-event="admin-panel-categories-title"]')
    .fill(title);
  await page
    .locator('[data-umami-event="admin-panel-categories-slug"]')
    .fill(slug);
  await Promise.all([
    page.waitForResponse(categoryCall('POST')),
    page.locator('[data-umami-event="admin-panel-categories-create"]').click(),
  ]);
  await expect(rowFor(page, slug)).toContainText(title);

  // Renamed in place: the row turns into its own fields, then saves.
  await rowFor(page, slug)
    .locator('[data-umami-event="admin-panel-categories-edit"]')
    .click();
  const editing = page.locator('tr', {
    has: page.locator('[data-umami-event="admin-panel-categories-row-title"]'),
  });
  await editing
    .locator('[data-umami-event="admin-panel-categories-row-title"]')
    .fill(renamed);
  await Promise.all([
    page.waitForResponse(categoryCall('PUT')),
    editing.locator('[data-umami-event="admin-panel-categories-save"]').click(),
  ]);
  await expect(rowFor(page, slug)).toContainText(renamed);

  // No product uses it, so it deletes outright.
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([
    page.waitForResponse(categoryCall('DELETE')),
    rowFor(page, slug)
      .locator('[data-umami-event="admin-panel-categories-delete"]')
      .click(),
  ]);
  await expect(rowFor(page, slug)).toHaveCount(0);
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
