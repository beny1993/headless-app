import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CategoryDao } from '@/db/dao/CategoryDao';
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

  const [product, categories] = await Promise.all([
    ProductDao.findByIdForAdmin(parsed.data),
    CategoryDao.list(),
  ]);
  if (!product) notFound();

  return (
    <ProductForm
      key={product.id}
      categories={categories.map(({ id, title }) => ({ id, title }))}
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
        petTypes: product.petTypes,
        isActive: product.isActive,
        imageKey: product.images[0]?.objectKey ?? null,
      }}
    />
  );
}
