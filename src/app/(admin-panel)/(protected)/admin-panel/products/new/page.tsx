import type { Metadata } from 'next';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductForm } from '@/features/admin-panel/products/product-form';

export const metadata: Metadata = { title: 'محصول جدید' };

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const categories = await CategoryDao.list();
  return (
    <ProductForm
      categories={categories.map(({ id, title }) => ({ id, title }))}
    />
  );
}
