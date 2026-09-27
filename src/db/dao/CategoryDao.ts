// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { asc, eq, inArray, or } from 'drizzle-orm';
import { db, type Executor } from '@/db';
import {
  categories,
  productCategories,
  products,
  type Category,
} from '@/db/schema/catalog';
import {
  CATEGORY_PARENT_MESSAGES,
  type CategoryParentReason,
} from '@/lib/catalog/category-input';

/** What the admin supplies. The database owns `id` and both timestamps. */
export type CategoryInput = {
  title: string;
  slug: string;
  sortOrder: number;
  /** `null` for a top-level category. */
  parentId: string | null;
  /**
   * The tile photo's storage key, `null` for none. Omitted means none on
   * `create` and «leave it as it is» on `update`, where only an explicit null
   * removes a photo.
   */
  imageKey?: string | null;
};

/**
 * A parent the one-level rule refuses. Thrown rather than returned so no caller
 * can write the row by ignoring it; the admin routes turn `reason` into the
 * matching Persian message on the `parentId` field.
 */
export class CategoryParentError extends Error {
  constructor(readonly reason: CategoryParentReason) {
    super(CATEGORY_PARENT_MESSAGES[reason]);
    this.name = 'CategoryParentError';
  }
}

export class CategoryDao {
  /** Storefront order: the hand-set `sortOrder` first, title as the tiebreak. */
  static async list(): Promise<Category[]> {
    return db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.title));
  }

  /**
   * Insert-or-update by slug. The seed relies on this to stay idempotent.
   *
   * `parentId` is set on the **insert only** — it is deliberately absent from
   * the conflict `set`, so re-running the seed can neither undo a move an admin
   * made in the panel nor build a third level out of one. That is also why this
   * one write skips the guard below: the seed is its only caller. The photo is
   * demo state like the title and the order, so a re-run puts it back.
   */
  static async upsertBySlug(input: {
    title: string;
    slug: string;
    sortOrder?: number;
    parentId?: string | null;
    imageKey?: string | null;
  }): Promise<Category> {
    const [row] = await db
      .insert(categories)
      .values(input)
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          title: input.title,
          sortOrder: input.sortOrder ?? 0,
          imageKey: input.imageKey ?? null,
        },
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
    parentId,
    imageKey = null,
  }: CategoryInput): Promise<Category> {
    return db.transaction(async (tx) => {
      await CategoryDao.assertParent(tx, null, parentId);
      const [row] = await tx
        .insert(categories)
        .values({ title, slug, sortOrder, parentId, imageKey })
        .returning();
      return row;
    });
  }

  /**
   * Replaces title, slug, sort order and parent, and the photo when the input
   * names one (`undefined` is skipped by `.set`, so the stored key stays).
   * `null` for an unknown id. A parent the one-level rule refuses throws
   * {@link CategoryParentError} and writes nothing.
   */
  static async update(
    id: string,
    { title, slug, sortOrder, parentId, imageKey }: CategoryInput,
  ): Promise<Category | null> {
    return db.transaction(async (tx) => {
      await CategoryDao.assertParent(tx, id, parentId);
      const [row] = await tx
        .update(categories)
        .set({ title, slug, sortOrder, parentId, imageKey })
        .where(eq(categories.id, id))
        .returning();
      return row ?? null;
    });
  }

  /**
   * The one-level rule, as the guard read that also locks what it checked.
   *
   * `for update` on the pair blocks a concurrent move of either row until this
   * transaction commits, and it blocks the `FOR KEY SHARE` a concurrent child
   * insert needs on its parent — so the second writer re-reads the committed
   * state and is refused rather than building a third level between them.
   * `order by id` gives the opposite moves (X under Y, Y under X) the same lock
   * order, so they cannot deadlock. `id` is `null` on a create: there is no row
   * yet to lock or to have children.
   */
  private static async assertParent(
    tx: Executor,
    id: string | null,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) throw new CategoryParentError('self');

    const locked = await tx
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(inArray(categories.id, id === null ? [parentId] : [parentId, id]))
      .orderBy(asc(categories.id))
      .for('update');

    const parent = locked.find((row) => row.id === parentId);
    if (!parent) throw new CategoryParentError('unknown');
    if (parent.parentId !== null) throw new CategoryParentError('nested');
    // The lock read cannot see this — a child names its parent, not the other
    // way round — so it is a second statement inside the same transaction.
    if (id !== null && (await CategoryDao.countChildren(id, tx)) > 0) {
      throw new CategoryParentError('hasChildren');
    }
  }

  /**
   * Hard-deletes a category — nothing snapshots one, so no order needs the row.
   * `null` for an unknown id. While any product references it, active or not,
   * the products foreign key (`ON DELETE RESTRICT`) throws 23503 instead — and
   * so does the parent foreign key while a sub-category sits under it.
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
   * exactly the rows the two foreign keys see when they refuse a delete: the
   * products filed under it, plus the ones that merely list it among their
   * additional categories.
   *
   * Counted over `products` with a subquery rather than joined to the junction,
   * so a product that is filed there twice over is one product, not two.
   */
  static async countProducts(id: string): Promise<number> {
    return db.$count(
      products,
      or(
        eq(products.categoryId, id),
        inArray(
          products.id,
          db
            .select({ id: productCategories.productId })
            .from(productCategories)
            .where(eq(productCategories.categoryId, id)),
        ),
      ),
    );
  }

  /**
   * How many sub-categories sit under the category — the other half of the
   * delete refusal, and the guard's «has children» read. Takes an executor so
   * {@link assertParent} can ask inside its own transaction.
   */
  static async countChildren(id: string, on: Executor = db): Promise<number> {
    return on.$count(categories, eq(categories.parentId, id));
  }
}
