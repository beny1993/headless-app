import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CONTENT_AREAS, isVisible } from '@/lib/content/site-content';
import { CategoriesSection } from '@/features/storefront/home/categories';
import { CommunitySection } from '@/features/storefront/home/community';
import { FeaturedStorySection } from '@/features/storefront/home/featured-story';
import { selectFeatured } from '@/features/storefront/home/featured';
import { HeroSection } from '@/features/storefront/home/hero';
import { JourneySection } from '@/features/storefront/home/journey';
import { LifeMomentsSection } from '@/features/storefront/home/life-moments';
import { PhilosophySection } from '@/features/storefront/home/philosophy';
import { RecommendsSection } from '@/features/storefront/home/recommends';
import { RoutineSection } from '@/features/storefront/home/routine';

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
  // Independent single-DAO reads, so they belong here rather than in
  // `src/logic/` — that is for operations that span DAOs. The content read is
  // one primary-key `IN` over the home area's rows; a missing or invalid row
  // resolves to its default inside the DAO, so an empty table renders today's copy.
  const [{ items }, categories, content] = await Promise.all([
    ProductDao.list(),
    CategoryDao.list(),
    SiteContentDao.getMany(CONTENT_AREAS.home.keys),
  ]);

  // Narrow rows to what the sections render: `Category` also carries
  // timestamps, and several of these sections are client components.
  const tiles = categories.map(({ title, slug }) => ({ title, slug }));

  // Every section is editable now, and each renders unless the admin has
  // explicitly hidden it (`isVisible` = "shown unless visible === false"); an
  // empty table and every pre-existing row render exactly as before. Catalog
  // *data* still comes from the DAOs above — only the sections' chrome is content.
  return (
    <main>
      {isVisible(content['home.hero']) && (
        <HeroSection content={content['home.hero']} />
      )}
      {isVisible(content['home.moments']) && (
        <LifeMomentsSection content={content['home.moments']} />
      )}
      {isVisible(content['home.recommends']) && (
        <RecommendsSection
          content={content['home.recommends']}
          products={selectFeatured(items)}
        />
      )}
      {isVisible(content['home.journey']) && (
        <JourneySection content={content['home.journey']} />
      )}
      {isVisible(content['home.guide']) && (
        <FeaturedStorySection content={content['home.guide']} />
      )}
      {isVisible(content['home.routine']) && (
        <RoutineSection content={content['home.routine']} categories={tiles} />
      )}
      {isVisible(content['home.family']) && (
        <CommunitySection content={content['home.family']} />
      )}
      {isVisible(content['home.categories']) && (
        <CategoriesSection
          content={content['home.categories']}
          categories={tiles}
        />
      )}
      {isVisible(content['home.philosophy']) && (
        <PhilosophySection content={content['home.philosophy']} />
      )}
    </main>
  );
}
