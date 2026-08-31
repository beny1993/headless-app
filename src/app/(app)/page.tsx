import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
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
  // Two independent single-DAO reads, so they belong here rather than in
  // `src/logic/` — that is for operations that span DAOs.
  const [{ items }, categories] = await Promise.all([
    ProductDao.list(),
    CategoryDao.list(),
  ]);

  // Narrow rows to what the sections render: `Category` also carries
  // timestamps, and two of these sections are client components.
  const tiles = categories.map(({ title, slug }) => ({ title, slug }));

  return (
    <main>
      <HeroSection />
      <LifeMomentsSection />
      <RecommendsSection products={selectFeatured(items)} />
      <JourneySection />
      <FeaturedStorySection />
      <RoutineSection categories={tiles} />
      <CommunitySection />
      <CategoriesSection categories={tiles} />
      <PhilosophySection />
    </main>
  );
}
