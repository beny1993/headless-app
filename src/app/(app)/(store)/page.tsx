import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { ProductDao } from '@/db/dao/ProductDao';
import { CONTENT_AREAS, isVisible } from '@/lib/content/site-content';
import { loadFeaturedPicks } from '@/logic/content/featured-picks';
import { loadLinkTargets } from '@/logic/content/link-targets';
import {
  storefrontCategories,
  storefrontContent,
} from '@/logic/storefront/cached-reads';
import { CategoriesSection } from '@/features/storefront/home/categories';
import { FeaturedStorySection } from '@/features/storefront/home/featured-story';
import { selectFeatured } from '@/features/storefront/home/featured';
import { HeroSection } from '@/features/storefront/home/hero';
import { PhilosophySection } from '@/features/storefront/home/philosophy';
import { RecommendsSection } from '@/features/storefront/home/recommends';
import { PATHS } from '@/lib/constant/paths';
import { absoluteUrl, SITE_JSON_LD } from '@/lib/seo';

/** Title and description are the site's own, from the root layout. */
export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl(PATHS.HOME) },
};

/**
 * The storefront home page, ported from `design/src/app/App.tsx`.
 *
 * Rendered per request. Left on `auto` this page would be prerendered at build
 * time: the featured products would freeze into the HTML until the next
 * deploy, and `next build` would need a reachable database — which the Docker
 * image build will not have. Neither is visible in `next dev`, which always
 * renders per request.
 *
 * The newsletter section is not here and is not missing: it was cut outright
 * (Benyamin, 2026-08-29).
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Independent reads, in parallel. The product listing is live — it shows
  // stock — while the categories and the content come from the storefront cache
  // an admin save drops (`src/logic/storefront/cached-reads.ts`). A missing or
  // invalid content row resolves to its default, so an empty table renders
  // today's copy.
  const [{ items }, categories, content] = await Promise.all([
    ProductDao.list(),
    storefrontCategories(),
    storefrontContent(),
  ]);

  // Saved destinations store catalog ids: resolve them once for every linked
  // section, reusing the categories just read (so only linked products query).
  // The «انتخاب‌های اسموکی» boxes the admin picked a product for resolve beside
  // them, as cards — from the listing page just read where they are on it, so
  // no query at all then — and only while the section is shown. A hidden
  // product or a family member does not come back; `selectFeatured` refills
  // its box.
  const recommends = content['home.recommends'];
  const [targets, picks] = await Promise.all([
    loadLinkTargets(
      CONTENT_AREAS.home.keys.map((key) => content[key]),
      categories,
    ),
    isVisible(recommends)
      ? loadFeaturedPicks(recommends.productIds, items)
      : [],
  ]);

  // Narrow rows to what the sections render: `Category` also carries
  // timestamps, and several of these sections are client components.
  // Top-level only — sub-categories would crowd the strip. `loadLinkTargets`
  // above still sees every row, so a saved link to a sub-category keeps
  // resolving.
  const tiles = categories
    .filter((category) => category.parentId === null)
    .map(({ id, title, slug, imageKey }) => ({ id, title, slug, imageKey }));
  // Every slug, sub-categories included: the sections' built-in links are
  // checked against it, since the shop answers an unknown category with a 404.
  const categorySlugs = categories.map(({ slug }) => slug);

  // Every section is editable now, and each renders unless the admin has
  // explicitly hidden it (`isVisible` = "shown unless visible === false"); an
  // empty table and every pre-existing row render exactly as before. Catalog
  // *data* still comes from the catalog — content holds the sections' chrome,
  // and only the ids of the products the admin picked.
  return (
    <main>
      <JsonLd data={SITE_JSON_LD} />
      {isVisible(content['home.hero']) && (
        <HeroSection content={content['home.hero']} targets={targets} />
      )}
      {isVisible(recommends) && (
        <RecommendsSection
          content={recommends}
          products={selectFeatured(items, picks)}
        />
      )}
      {isVisible(content['home.guide']) && (
        <FeaturedStorySection
          content={content['home.guide']}
          targets={targets}
          categorySlugs={categorySlugs}
        />
      )}
      {isVisible(content['home.categories']) && (
        <CategoriesSection
          content={content['home.categories']}
          categories={tiles}
          targets={targets}
        />
      )}
      {isVisible(content['home.philosophy']) && (
        <PhilosophySection
          content={content['home.philosophy']}
          targets={targets}
        />
      )}
    </main>
  );
}
