import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CONTENT_AREAS, isVisible } from '@/lib/content/site-content';
import { loadLinkTargets } from '@/logic/content/link-targets';
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

  // The «انتخاب‌های اسموکی» boxes the admin picked a product for, read as the
  // listing's own cards — a hidden product or a family member does not come
  // back, and `selectFeatured` refills its box. No pick, no query.
  const picks: readonly (string | null)[] =
    content['home.recommends'].productIds ?? [];
  const pickedIds = picks.filter((id) => id !== null);

  // Saved destinations store catalog ids: resolve them once for every linked
  // section, reusing the categories just read (so only linked products query).
  const [targets, picked] = await Promise.all([
    loadLinkTargets(Object.values(content), categories),
    pickedIds.length > 0 ? ProductDao.list({ ids: pickedIds }) : { items: [] },
  ]);
  const cardOf = new Map(picked.items.map((card) => [card.id, card]));

  // Narrow rows to what the sections render: `Category` also carries
  // timestamps, and several of these sections are client components.
  // Top-level only — sub-categories would crowd the strip. `loadLinkTargets`
  // above still sees every row, so a saved link to a sub-category keeps
  // resolving.
  const tiles = categories
    .filter((category) => category.parentId === null)
    .map(({ id, title, slug, imageKey }) => ({ id, title, slug, imageKey }));

  // Every section is editable now, and each renders unless the admin has
  // explicitly hidden it (`isVisible` = "shown unless visible === false"); an
  // empty table and every pre-existing row render exactly as before. Catalog
  // *data* still comes from the DAOs above — content holds the sections' chrome,
  // and only the ids of the products the admin picked.
  return (
    <main>
      {isVisible(content['home.hero']) && (
        <HeroSection content={content['home.hero']} targets={targets} />
      )}
      {isVisible(content['home.moments']) && (
        <LifeMomentsSection
          content={content['home.moments']}
          targets={targets}
        />
      )}
      {isVisible(content['home.recommends']) && (
        <RecommendsSection
          content={content['home.recommends']}
          products={selectFeatured(
            items,
            picks.map((id) => (id ? cardOf.get(id) : undefined)),
          )}
        />
      )}
      {isVisible(content['home.journey']) && (
        <JourneySection content={content['home.journey']} />
      )}
      {isVisible(content['home.guide']) && (
        <FeaturedStorySection
          content={content['home.guide']}
          targets={targets}
        />
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
