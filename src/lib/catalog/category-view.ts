// The admin category projection: one client-safe definition of what the admin
// category routes return and what `/admin-panel/products/categories` renders its
// first paint from. A separate module from `category-input.ts`, which is the
// other direction of the same resource — what a client may SEND.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the
// category manager is a client component. `Category` is a TYPE import, which is
// erased; keeping the projector here is what stops the categories server page
// importing a value out of a Hono route for one pure function.
import { z } from 'zod';
import type { Category } from '@/db/schema/catalog';

/**
 * The category payload — what every admin category route returns and the admin
 * list renders. `src/lib/hono/routes/admin-categories.ts` registers this shape
 * under `AdminCategory`.
 */
export const categoryViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  sortOrder: z.number().int().nonnegative(),
  /** The category this one sits under; `null` for a top-level one. */
  parentId: z.uuid().nullable(),
  /** The tile photo's storage key — render it through `imageSrc`. */
  imageKey: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CategoryView = z.infer<typeof categoryViewSchema>;

/** Project a DAO row to the admin response — ISO the dates. */
export const toCategoryView = (row: Category): CategoryView => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  sortOrder: row.sortOrder,
  parentId: row.parentId,
  imageKey: row.imageKey,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
