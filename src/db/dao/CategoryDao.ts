// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { asc, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { categories, products, type Category } from '@/db/schema/catalog';

/** What the admin supplies. The database owns `id` and both timestamps. */
export type CategoryInput = { title: string; slug: string; sortOrder: number };

export class CategoryDao {
  /** Storefront order: the hand-set `sortOrder` first, title as the tiebreak. */
  static async list(): Promise<Category[]> {
    return db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.title));
  }

  /** Insert-or-update by slug. The seed relies on this to stay idempotent. */
  static async upsertBySlug(input: {
    title: string;
    slug: string;
    sortOrder?: number;
  }): Promise<Category> {
    const [row] = await db
      .insert(categories)
      .values(input)
      .onConflictDoUpdate({
        target: categories.slug,
        set: { title: input.title, sortOrder: input.sortOrder ?? 0 },
      })
      .returning();
    return row;
  }

  /**
   * Inserts a new category. Unlike `upsertBySlug`, a taken slug is an error
   * (23505 `categories_slug_unique`), never a silent overwrite of another
   * category's title and order. Fields are picked by name, so a caller reaching
   * past `CategoryInput` cannot pin an `id`.
   */
  static async create({
    title,
    slug,
    sortOrder,
  }: CategoryInput): Promise<Category> {
    const [row] = await db
      .insert(categories)
      .values({ title, slug, sortOrder })
      .returning();
    return row;
  }

  /** Replaces title, slug and sort order. `null` for an unknown id. */
  static async update(
    id: string,
    { title, slug, sortOrder }: CategoryInput,
  ): Promise<Category | null> {
    const [row] = await db
      .update(categories)
      .set({ title, slug, sortOrder })
      .where(eq(categories.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Hard-deletes a category — nothing snapshots one, so no order needs the row.
   * `null` for an unknown id. While any product references it, active or not,
   * the products foreign key (`ON DELETE RESTRICT`) throws 23503 instead.
   */
  static async deleteById(id: string): Promise<Category | null> {
    const [row] = await db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * How many products reference the category, soft-deleted ones included —
   * exactly the rows the foreign key sees when it refuses a delete.
   */
  static async countProducts(id: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(products)
      .where(eq(products.categoryId, id));
    return row?.value ?? 0;
  }
}
