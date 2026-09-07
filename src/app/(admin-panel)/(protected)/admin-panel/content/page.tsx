import type { Metadata } from 'next';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CONTENT_KEYS } from '@/lib/content/site-content';
import { ContentEditor } from '@/features/admin-panel/content/content-editor';

export const metadata: Metadata = { title: 'محتوای سایت' };

// Reads live content per request. Authz is the (protected) layout's
// requireAdmin() — a session alone is never authorization; nothing to add here.
export const dynamic = 'force-dynamic';

export default async function AdminContentPage() {
  const values = await SiteContentDao.getMany(CONTENT_KEYS);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black">محتوای سایت</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          متن‌ها و تصاویر بخش‌های ثابت صفحه اصلی و درباره ما. هر بخش جداگانه
          ذخیره می‌شود؛ تغییرات بلافاصله در فروشگاه دیده می‌شوند.
        </p>
      </div>
      <ContentEditor values={values} />
    </div>
  );
}
