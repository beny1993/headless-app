// The home page's content→section wiring and data path. Needs a live database
// (see src/db/test-db.ts): the page reads the catalog alongside the four content
// blocks, so calling it exercises the real DAOs.
//
// Unlike the About test we do NOT deep-render every child — the home page also
// composes catalog-driven client sections. We assert the *wiring* instead: each
// content block must reach its own section. This matters because the block value
// types are structural supersets of one another (`home.hero` ⊇ `home.guide`), so
// a swapped `content={…}` prop type-checks silently — neither `tsc` nor a
// presence-only string check would catch it. Inspecting each section element's
// `content` prop does.
//
// The four home keys are cleared before and after each case: the storefront and
// the admin editor share this table on the shared dev database, so a crashed
// prior run must not leak a row into the "empty table → defaults" case.
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { CommunitySection } from '@/features/storefront/home/community';
import { FeaturedStorySection } from '@/features/storefront/home/featured-story';
import { HeroSection } from '@/features/storefront/home/hero';
import { PhilosophySection } from '@/features/storefront/home/philosophy';

const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);
const page = await importWithDb(() => import('./page'));

const HOME_KEYS = [
  'home.hero',
  'home.guide',
  'home.philosophy',
  'home.family',
] as const;

// The section component → content key pairing the page must honor.
const WIRING = [
  [HeroSection, 'home.hero'],
  [FeaturedStorySection, 'home.guide'],
  [CommunitySection, 'home.family'],
  [PhilosophySection, 'home.philosophy'],
] as const;

type El = { type: unknown; props: Record<string, unknown> };

const isEl = (n: unknown): n is El =>
  typeof n === 'object' && n !== null && 'type' in n && 'props' in n;

/** The direct child element of the returned <main> whose type is `type`. */
const findSection = (tree: unknown, type: unknown): El | undefined => {
  if (!isEl(tree)) return undefined;
  const children = tree.props.children;
  const list = Array.isArray(children) ? children : [children];
  return list.find((c): c is El => isEl(c) && c.type === type);
};

describe.skipIf(!databaseReachable)('the home page', () => {
  const clear = () =>
    testDb.delete(siteContent).where(inArray(siteContent.key, [...HOME_KEYS]));

  beforeEach(clear);
  afterEach(clear);

  it('wires each content block to its own section (empty table → its default)', async () => {
    const tree = await page.default();
    for (const [type, key] of WIRING) {
      const section = findSection(tree, type);
      expect(section, `section for ${key} is present`).toBeDefined();
      // The exact block reaches the exact section — a swap would put the wrong
      // default here and fail, even though the types would allow it.
      expect(section?.props.content).toEqual(DEFAULT_CONTENT[key]);
    }
  });

  it('shows a saved block on the very next load (no cache to go stale)', async () => {
    await SiteContentDao.set('home.hero', {
      ...DEFAULT_CONTENT['home.hero'],
      eyebrow: 'سلام تازه‌وارد',
    });

    const hero = findSection(await page.default(), HeroSection);
    expect((hero?.props.content as { eyebrow: string }).eyebrow).toBe(
      'سلام تازه‌وارد',
    );
  });
});
