import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDao } from '@/db/dao/ProductDao';

// Placeholder so the home page's product cards have a real destination instead
// of a 404 — the same stand-in `/shop` and `/about` got. The page itself is
// ported from `design/` by [[Story - Product Detail Page]].
//
// It still resolves the slug against the catalog: a link to a product that
// does not exist, or that a soft delete hid, must answer 404 and not a
// plausible-looking page.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await ProductDao.getBySlug(slug);

  return { title: product?.title ?? 'محصول' };
}

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const product = await ProductDao.getBySlug(slug);
  if (!product) notFound();

  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black">{product.title}</h1>
      <p className="text-muted-foreground mt-3">
        صفحه محصول در استوری «Product Detail Page» ساخته می‌شود.
      </p>
    </main>
  );
}
