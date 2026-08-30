// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
//
// Products are soft-deleted, never removed: `order_items` snapshots a product's
// title, sku and unit price, and support needs the row behind that snapshot to
// still exist. There is deliberately no hard-delete method here — the storefront
// reads filter on `is_active` instead.
import { and, asc, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  categories,
  productImages,
  products,
  type NewProduct,
  type PetType,
  type Product,
  type ProductImage,
  type ProductWithImages,
} from '@/db/schema/catalog';

/** What a caller supplies; the database owns the id and both timestamps. */
export type ProductInput = Omit<NewProduct, 'id' | 'createdAt' | 'updatedAt'>;

export type ProductFilters = {
  categorySlug?: string;
  petType?: PetType;
};

export class ProductDao {
  /** Storefront listing — active products only, whatever the filters say. */
  static async list(
    filters: ProductFilters = {},
  ): Promise<ProductWithImages[]> {
    const where = [eq(products.isActive, true)];
    if (filters.categorySlug) {
      where.push(eq(categories.slug, filters.categorySlug));
    }
    if (filters.petType) {
      where.push(eq(products.petType, filters.petType));
    }

    const rows = await db
      .select(getTableColumns(products))
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...where))
      .orderBy(desc(products.createdAt), asc(products.sku));

    return ProductDao.withImages(rows);
  }

  /** Admin panel listing — includes the products a soft delete hid. */
  static async listForAdmin(): Promise<ProductWithImages[]> {
    const rows = await db
      .select()
      .from(products)
      .orderBy(desc(products.createdAt), asc(products.sku));

    return ProductDao.withImages(rows);
  }

  /** Storefront product page. An inactive product reads as absent. */
  static async getBySlug(slug: string): Promise<ProductWithImages | null> {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.isActive, true)))
      .limit(1);

    const [row] = await ProductDao.withImages(rows);
    return row ?? null;
  }

  static async create(input: ProductInput): Promise<Product> {
    const [row] = await db.insert(products).values(input).returning();
    return row;
  }

  static async update(
    id: string,
    patch: Partial<ProductInput>,
  ): Promise<Product | null> {
    const [row] = await db
      .update(products)
      .set(patch)
      .where(eq(products.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * The only removal path there is: the row stays, the storefront stops seeing
   * it, the admin panel still does.
   */
  static async softDelete(id: string): Promise<Product | null> {
    const [row] = await db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Insert-or-update by sku, which is what makes the seed re-runnable.
   * `isActive` is deliberately absent from the update: re-seeding must not
   * resurrect a product somebody removed on purpose.
   */
  static async upsertBySku(input: ProductInput): Promise<Product> {
    const [row] = await db
      .insert(products)
      .values(input)
      .onConflictDoUpdate({
        target: products.sku,
        set: {
          title: input.title,
          slug: input.slug,
          brand: input.brand ?? null,
          description: input.description ?? null,
          benefit: input.benefit ?? null,
          price: input.price,
          oldPrice: input.oldPrice ?? null,
          stock: input.stock ?? 0,
          categoryId: input.categoryId,
          petType: input.petType,
        },
      })
      .returning();
    return row;
  }

  /**
   * Replaces a product's gallery wholesale — position in `objectKeys` becomes
   * `sortOrder`. Replacing rather than appending is what keeps a re-run of the
   * seed from stacking duplicate images.
   */
  static async setImages(
    productId: string,
    objectKeys: string[],
  ): Promise<ProductImage[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(productImages)
        .where(eq(productImages.productId, productId));

      if (objectKeys.length === 0) return [];

      return tx
        .insert(productImages)
        .values(
          objectKeys.map((objectKey, index) => ({
            productId,
            objectKey,
            sortOrder: index,
          })),
        )
        .returning();
    });
  }

  /** One extra query for the whole page of products, not one per product. */
  private static async withImages(
    rows: Product[],
  ): Promise<ProductWithImages[]> {
    if (rows.length === 0) return [];

    const images = await db
      .select()
      .from(productImages)
      .where(
        inArray(
          productImages.productId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(productImages.sortOrder));

    const byProduct = new Map<string, ProductImage[]>();
    for (const image of images) {
      const existing = byProduct.get(image.productId);
      if (existing) existing.push(image);
      else byProduct.set(image.productId, [image]);
    }

    return rows.map((row) => ({ ...row, images: byProduct.get(row.id) ?? [] }));
  }
}
