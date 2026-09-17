import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { CategoryManager } from '@/features/admin-panel/categories/category-manager';
import { toCategoryView } from '@/lib/hono/routes/admin-categories';

export const metadata: Metadata = { title: 'دسته‌بندی‌ها' };

// Reads live per request: a category added here must reach the product form and
// the storefront strip on their next load.
export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  await requireAdmin();
  const categories = await CategoryDao.list();

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-black">دسته‌بندی‌ها</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          دسته‌بندی‌ها بلافاصله در فروشگاه و فرم محصول دیده می‌شوند، به ترتیب
          نمایش (عدد کمتر، اول). هر دسته‌بندی می‌تواند زیردسته داشته باشد، اما
          فقط یک سطح؛ زیردسته خودش زیردسته نمی‌گیرد. دسته‌بندی‌ای که محصول یا
          زیردسته دارد حذف نمی‌شود؛ اول آن‌ها را جابه‌جا یا حذف کن.
        </p>
      </div>
      <CategoryManager initialCategories={categories.map(toCategoryView)} />
    </div>
  );
}
