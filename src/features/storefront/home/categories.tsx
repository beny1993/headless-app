import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { CATEGORY_IMAGES } from './content';
import type { ContentValue } from '@/lib/content/site-content';
import { shopPath } from '@/lib/constant/paths';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';

export type CategoryTile = { id: string; title: string; slug: string };

/**
 * The category strip. The section heading and the «همه دسته‌بندی‌ها» label are
 * admin content (`home.categories`), and so is where that label goes (unset: the
 * bare shop); the tiles themselves —
 * titles and slugs from the database, photos from `CATEGORY_IMAGES[slug]` — stay
 * in code (a `categories.image_key` catalog story would move the photos later). A
 * category added in the admin panel appears here without a code change; one with
 * no photo falls back to a plain surface rather than a broken image.
 *
 * Real `<Link>`s, not clickable `<div>`s (design review) — keyboard-reachable,
 * cmd-clickable, and crawlable.
 */
export function CategoriesSection({
  content,
  categories,
  targets,
}: {
  content: ContentValue<'home.categories'>;
  categories: CategoryTile[];
  targets: LinkTargets;
}) {
  if (categories.length === 0) return null;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-12 flex items-end justify-between gap-4">
          <ContentLink
            {...resolveLink(content.ctaLink, shopPath(), targets)}
            className="text-accent-strong flex items-center gap-1 text-sm font-medium hover:underline"
            data-umami-event="home-categories-all-click"
          >
            {/* In RTL the "forward" chevron points left. */}
            <ChevronLeft size={14} aria-hidden="true" />
            {content.cta}
          </ContentLink>
          <h2 className="text-4xl font-black">{content.headline}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {categories.map((category, index) => {
            const image = CATEGORY_IMAGES[category.slug];
            // The first and fourth tiles run tall, as in the design's mosaic.
            const tall = index === 0 || index === 3;

            return (
              <Link
                key={category.slug}
                href={shopPath({ category: category.slug })}
                className={`group bg-secondary relative block min-h-40 overflow-hidden rounded-2xl ${
                  tall ? 'row-span-2' : ''
                }`}
                data-umami-event="home-category-click"
              >
                {image && (
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-black/40 transition-colors group-hover:bg-black/30" />
                <h3 className="absolute end-4 bottom-4 text-xl font-black text-white">
                  {category.title}
                </h3>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
