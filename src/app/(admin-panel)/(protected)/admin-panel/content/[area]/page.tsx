import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { categoryOptions } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import type { ProductWithImages } from '@/db/schema/catalog';
import { displayTitle } from '@/lib/catalog/variant';
import { CONTENT_AREAS, contentAreaSchema } from '@/lib/content/site-content';
import { ContentEditor } from '@/features/admin-panel/content/content-editor';
import type { LinkOption } from '@/features/admin-panel/content/link-picker';

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
  // Independent reads: the blocks, and what their destination pickers offer —
  // every category and the active products (saving a link to a hidden product
  // is refused), narrowed to id/title/slug for the client editor.
  const [values, categories, products] = await Promise.all([
    SiteContentDao.getMany(area.keys),
    CategoryDao.list(),
    // ponytail: listForAdmin also loads images the picker never shows; a slim
    // id/title/slug listing when the catalog grows.
    ProductDao.listForAdmin({ active: true }),
  ]);
  /**
   * Products need the label too: the members of a family share one `title`, so
   * a picker listing them plainly offers three identical options and the admin
   * cannot tell which size they are linking to.
   */
  const productOption = (product: ProductWithImages): LinkOption => ({
    id: product.id,
    title: displayTitle(product),
    slug: product.slug,
  });

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black">{area.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          متن‌ها و تصاویر این بخش از سایت. هر بلوک جداگانه ذخیره می‌شود؛ تغییرات
          بلافاصله در فروشگاه دیده می‌شوند.
        </p>
      </div>
      <ContentEditor
        keys={area.keys}
        values={values}
        options={{
          // Tree order, carrying both forms: `label` is the indented line the
          // select shows, `title` the bare name a chip and the «به این ترتیب»
          // sentence use — those were rendering the indent as «— شامپو و
          // نظافت», a dash with nothing before it.
          categories: categoryOptions(categories),
          products: products.map(productOption),
        }}
      />
    </div>
  );
}
