import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CONTENT_AREAS, contentAreaSchema } from '@/lib/content/site-content';
import { ContentEditor } from '@/features/admin-panel/content/content-editor';

// Reads live content per request; the page checks the role before data access.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>;
}): Promise<Metadata> {
  const parsed = contentAreaSchema.safeParse((await params).area);
  const title = parsed.success
    ? CONTENT_AREAS[parsed.data].title
    : 'محتوای سایت';
  return { title: `${title} — محتوای سایت` };
}

/**
 * One content area's editor — «صفحه اصلی» / «درباره ما» / «هدر» / «فوتر». The
 * dynamic `[area]` segment is validated against the zod enum; an unknown area is a
 * 404 (the products/[id] precedent). The bare `/admin-panel/content` redirects
 * here (home area), so v1's "«محتوای سایت» opens the content editor" stays true.
 */
export default async function AdminContentAreaPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  await requireAdmin();
  const parsed = contentAreaSchema.safeParse((await params).area);
  if (!parsed.success) notFound();

  const area = CONTENT_AREAS[parsed.data];
  const values = await SiteContentDao.getMany(area.keys);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black">{area.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          متن‌ها و تصاویر این بخش از سایت. هر بلوک جداگانه ذخیره می‌شود؛ تغییرات
          بلافاصله در فروشگاه دیده می‌شوند.
        </p>
      </div>
      <ContentEditor keys={area.keys} values={values} />
    </div>
  );
}
