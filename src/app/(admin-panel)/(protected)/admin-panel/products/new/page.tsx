import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { categoryOptions } from '@/lib/catalog/category-tree';
import { ProductForm } from '@/features/admin-panel/products/product-form';

export const metadata: Metadata = { title: 'محصول جدید' };

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requireAdmin();
  const categories = await CategoryDao.list();
  return (
    <ProductForm
      categories={categoryOptions(categories).map(({ id, label }) => ({
        id,
        title: label,
      }))}
    />
  );
}
