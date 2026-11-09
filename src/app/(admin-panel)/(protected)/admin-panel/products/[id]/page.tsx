import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { categoryOptions } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import { ProductForm } from '@/features/admin-panel/products/product-form';

export const metadata: Metadata = { title: 'ویرایش محصول' };

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  // A non-uuid id would raise a 22P02 on the uuid column; treat it as absent, the
  // same 404 an unknown product gets. `findByIdForAdmin` includes inactive rows,
  // so a soft-deleted product can still be reopened here.
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();

  // The row first, on its own: the «زیرمجموعه‌ی» options depend on the head it
  // already points at — a soft-deleted one has to stay in the list or the
  // select would contradict the column — and a 404 then costs no other query.
  const product = await ProductDao.findByIdForAdmin(parsed.data);
  if (!product) notFound();

  const [categories, variantHeads, hasMembers] = await Promise.all([
    CategoryDao.list(),
    // Never this product itself: a row cannot be its own head.
    ProductDao.listVariantHeads(parsed.data, product.variantOf),
    ProductDao.hasMembers(parsed.data),
  ]);

  return (
    <ProductForm
      key={product.id}
      categories={categoryOptions(categories)}
      variantHeads={variantHeads}
      hasMembers={hasMembers}
      product={{
        id: product.id,
        title: product.title,
        slug: product.slug,
        sku: product.sku,
        brand: product.brand,
        description: product.description,
        benefit: product.benefit,
        price: product.price,
        oldPrice: product.oldPrice,
        stock: product.stock,
        categoryId: product.categoryId,
        extraCategoryIds: product.extraCategoryIds,
        variantOf: product.variantOf,
        variantLabel: product.variantLabel,
        isActive: product.isActive,
        // The whole gallery, in sort order: the form reorders and removes,
        // not just replaces, so the first photo alone is no longer enough.
        images: product.images.map((image) => ({
          id: image.id,
          objectKey: image.objectKey,
        })),
      }}
    />
  );
}
