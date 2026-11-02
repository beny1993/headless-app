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
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categories } from '@/db/schema/catalog';
import { siteContent } from '@/db/schema/site-content';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { LinkTargets } from '@/lib/content/link';
import { CONTENT_AREAS } from '@/lib/content/site-content';
import { CategoriesSection } from '@/features/storefront/home/categories';
import { FeaturedStorySection } from '@/features/storefront/home/featured-story';
import { HeroSection } from '@/features/storefront/home/hero';
import { PhilosophySection } from '@/features/storefront/home/philosophy';
import { RecommendsSection } from '@/features/storefront/home/recommends';

const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);
const page = await importWithDb(() => import('./page'));

const HOME_KEYS = CONTENT_AREAS.home.keys;

// The section component → content key pairing the page must honor. Every home
// section is content-driven in v2, so every one is checked — a swapped
// `content={…}` prop type-checks silently (the value types are structural
// supersets), and only inspecting each section's own `content` prop catches it.
const WIRING = [
  [HeroSection, 'home.hero'],
  [RecommendsSection, 'home.recommends'],
  [FeaturedStorySection, 'home.guide'],
  [CategoriesSection, 'home.categories'],
  [PhilosophySection, 'home.philosophy'],
] as const;

// The sections that render a content link, and so need the page's link targets.
const LINKED_SECTIONS = [
  HeroSection,
  FeaturedStorySection,
  CategoriesSection,
  PhilosophySection,
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
    // No saved destination anywhere: every linked section gets empty maps.
    for (const type of LINKED_SECTIONS) {
      expect(findSection(tree, type)?.props.targets).toEqual({
        categories: {},
        products: {},
      });
    }
  });

  it('loads the targets a saved destination needs, once, for every linked section', async () => {
    const [category] = await testDb
      .insert(categories)
      .values({
        title: 'دسته کارت',
        slug: `home-${faker.string.alphanumeric(10).toLowerCase()}`,
      })
      .returning();
    try {
      await SiteContentDao.set('home.hero', {
        ...DEFAULT_CONTENT['home.hero'],
        shopCtaLink: { type: 'shop', categoryId: category.id },
      });

      const tree = await page.default();
      const targets = findSection(tree, HeroSection)?.props
        .targets as LinkTargets;
      expect(targets.categories[category.id]).toBe(category.slug);
      for (const type of LINKED_SECTIONS) {
        expect(findSection(tree, type)?.props.targets).toBe(targets);
      }
    } finally {
      await clear();
      await testDb.delete(categories).where(eq(categories.id, category.id));
    }
  });

  it('keeps sub-categories out of the strip while links still resolve to them', async () => {
    const token = () => `home-${faker.string.alphanumeric(10).toLowerCase()}`;
    const [parent] = await testDb
      .insert(categories)
      .values({ title: 'دسته مادر', slug: token() })
      .returning();
    const [sub] = await testDb
      .insert(categories)
      .values({ title: 'زیردسته', slug: token(), parentId: parent.id })
      .returning();
    try {
      await SiteContentDao.set('home.hero', {
        ...DEFAULT_CONTENT['home.hero'],
        shopCtaLink: { type: 'shop', categoryId: sub.id },
      });

      const tree = await page.default();
      const tiles = findSection(tree, CategoriesSection)?.props.categories as {
        id: string;
      }[];
      const targets = findSection(tree, HeroSection)?.props
        .targets as LinkTargets;

      expect(tiles.map((tile) => tile.id)).toContain(parent.id);
      expect(tiles.map((tile) => tile.id)).not.toContain(sub.id);
      // `loadLinkTargets` still gets every row, sub-categories included.
      expect(targets.categories[sub.id]).toBe(sub.slug);
    } finally {
      await clear();
      await testDb
        .delete(categories)
        .where(inArray(categories.id, [sub.id, parent.id]));
    }
  });

  it('hands each tile the photo key its category row carries', async () => {
    const imageKey = 'uploads/123e4567-e89b-42d3-a456-426614174000.jpg';
    const [category] = await testDb
      .insert(categories)
      .values({
        title: 'دسته عکس‌دار',
        slug: `home-${faker.string.alphanumeric(10).toLowerCase()}`,
        imageKey,
      })
      .returning();
    try {
      const tree = await page.default();
      const tiles = findSection(tree, CategoriesSection)?.props.categories as {
        id: string;
        imageKey: string | null;
      }[];

      expect(tiles.find((tile) => tile.id === category.id)?.imageKey).toBe(
        imageKey,
      );
    } finally {
      await testDb.delete(categories).where(eq(categories.id, category.id));
    }
  });

  describe('the «انتخاب‌های اسموکی» picks', () => {
    // Records each row as it is created, so a throw between inserts still
    // leaves nothing behind.
    const fx = new OrderFixtures();
    afterEach(() => fx.cleanup());

    it('puts each picked product in its own box, and refills a box whose pick is hidden', async () => {
      const category = await fx.category();
      // The listing reads newest first, so boxes in the other order prove the
      // grid follows the boxes and not the query.
      const older = await fx.product(category, {
        createdAt: new Date(Date.now() - 60_000),
      });
      const newer = await fx.product(category);
      const hidden = await fx.product(category, { isActive: false });
      // The newest deal is the automatic rule's first offer on any database —
      // an empty one included — so it is what must fill the hidden pick's box.
      const deal = await fx.product(category, { oldPrice: 150_000 });
      await SiteContentDao.set('home.recommends', {
        ...DEFAULT_CONTENT['home.recommends'],
        productIds: [older.id, newer.id, hidden.id, null],
      });

      const shown = (
        findSection(await page.default(), RecommendsSection)?.props
          .products as { id: string }[]
      ).map((product) => product.id);

      expect(shown.slice(0, 3)).toEqual([older.id, newer.id, deal.id]);
      expect(shown).not.toContain(hidden.id);
      expect(shown.length).toBeLessThanOrEqual(4);
      expect(new Set(shown).size).toBe(shown.length);
    });
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

  it('omits a section the admin has hidden (visible: false), keeps its siblings', async () => {
    await SiteContentDao.set('home.guide', {
      ...DEFAULT_CONTENT['home.guide'],
      visible: false,
    });

    const tree = await page.default();
    // The hidden editorial block is gone from the page entirely…
    expect(findSection(tree, FeaturedStorySection)).toBeUndefined();
    // …and an untouched sibling still renders.
    expect(findSection(tree, HeroSection)).toBeDefined();
  });
});
