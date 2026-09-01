import type { Metadata } from 'next';
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
 * Unlike the home and shop pages this one reads nothing from the database, so
 * it keeps the default rendering and is prerendered at build time: there is
 * nothing here that can go stale between deploys, and `next build` needs no
 * Postgres to produce it.
 */
export default function AboutPage() {
  return (
    <main>
      <AboutHero />
      <AboutStory />
      <AboutProcess />
      <AboutValues />
      <AboutCta />
    </main>
  );
}
