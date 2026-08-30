// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { categories, type Category } from '@/db/schema/catalog';

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
}
