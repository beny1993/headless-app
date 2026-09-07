import type { Metadata } from 'next';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CONTENT_AREAS, isVisible } from '@/lib/content/site-content';
import {
  AboutCta,
  AboutHero,
  AboutProcess,
  AboutStory,
  AboutValues,
} from '@/features/storefront/about/about-sections';

export const metadata: Metadata = {
  title: 'درباره ما',
  description:
    'داستان اسموکی و فرآیندی که هر محصول پیش از رسیدن به فروشگاه از آن می‌گذرد.',
};

/**
 * «درباره ما», ported from `design/src/app/App.tsx`.
 *
 * Rendered per request. This page's copy and photos now live in `site_content`,
 * so — like `/` and `/shop` — it must read the database per request rather than
 * prerender at build time: the Docker image build has no reachable database
 * (`next build` must not touch Postgres), and a build-time snapshot would freeze
 * the copy until the next deploy, defeating the admin editor. The read is one
 * primary-key `IN` over at most five small rows; a missing or invalid row
 * resolves to its default inside the DAO, so an empty table renders today's copy.
 */
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const content = await SiteContentDao.getMany(CONTENT_AREAS.about.keys);

  // Each section renders unless the admin has explicitly hidden it (`isVisible` =
  // "shown unless visible === false"); absent/true → shown, so an empty table
  // renders today's page unchanged.
  return (
    <main>
      {isVisible(content['about.hero']) && (
        <AboutHero content={content['about.hero']} />
      )}
      {isVisible(content['about.story']) && (
        <AboutStory content={content['about.story']} />
      )}
      {isVisible(content['about.process']) && (
        <AboutProcess content={content['about.process']} />
      )}
      {isVisible(content['about.values']) && (
        <AboutValues content={content['about.values']} />
      )}
      {isVisible(content['about.cta']) && (
        <AboutCta content={content['about.cta']} />
      )}
    </main>
  );
}
