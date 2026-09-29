// The catalog side of content links, against the dev Postgres: which slugs a
// block's saved ids resolve to (a renamed slug follows the id; a hidden product
// drops out, so its link falls back to the shop), and the save check that refuses
// an id naming nothing — each error on the field path the editor maps.
import { faker } from '@faker-js/faker';
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  categories,
  PET_TYPES,
  products,
  type Category,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { LINK_MESSAGES } from '@/lib/content/link';

const { findBrokenLinks, loadLinkTargets } = await importWithDb(
  () => import('./link-targets'),
);

type Product = typeof products.$inferSelect;

describe.skipIf(!databaseReachable)('content link targets', () => {
  const UNKNOWN_ID = faker.string.uuid();
  let category: Category;
  let active: Product;
  let hidden: Product;
  // A family: the head is a card the shop lists, the member is reached only
  // from the head's page.
  let head: Product;
  let member: Product;

  const insertProduct = async (
    isActive: boolean,
    family: Partial<Pick<Product, 'variantOf' | 'variantLabel'>> = {},
  ): Promise<Product> => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    const [row] = await testDb
      .insert(products)
      .values({
        title: 'غذای خشک گربه',
        slug: `links-${token}`,
        sku: `LINKS-${token.toUpperCase()}`,
        price: 1_000_000,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
        isActive,
        ...family,
      })
      .returning();
    return row;
  };

  beforeAll(async () => {
    [category] = await testDb
      .insert(categories)
      .values({
        title: 'دسته لینک‌ها',
        slug: `links-${faker.string.alphanumeric(10).toLowerCase()}`,
      })
      .returning();
    active = await insertProduct(true);
    hidden = await insertProduct(false);
    head = await insertProduct(true, { variantLabel: '۲ کیلوگرم' });
    member = await insertProduct(true, {
      variantOf: head.id,
      variantLabel: '۱۰ کیلوگرم',
    });
  });

  afterAll(async () => {
    if (!category) return;
    // Members first: `variant_of` restricts, so the head cannot go before them.
    await testDb
      .delete(products)
      .where(
        and(
          eq(products.categoryId, category.id),
          isNotNull(products.variantOf),
        ),
      );
    await testDb.delete(products).where(eq(products.categoryId, category.id));
    await testDb.delete(categories).where(eq(categories.id, category.id));
  });

  /** `home.moments` with card i linked to `links[i]` (null past the list). */
  const moments = (links: unknown[]) => ({
    ...DEFAULT_CONTENT['home.moments'],
    cards: DEFAULT_CONTENT['home.moments'].cards.map((card, i) => ({
      ...card,
      link: links[i] ?? null,
    })),
  });

  /** `home.routine` with the first tab's categories set to `ids`. */
  const routine = (ids: string[]) => {
    const block = DEFAULT_CONTENT['home.routine'];
    return {
      ...block,
      slots: [{ ...block.slots[0], categoryIds: ids }, ...block.slots.slice(1)],
    };
  };

  /** `home.recommends` with its four boxes holding `picks` (null: «خودکار»). */
  const recommends = (picks: (string | null)[]) => ({
    ...DEFAULT_CONTENT['home.recommends'],
    productIds: picks,
  });

  describe('loadLinkTargets', () => {
    it('maps category ids to slugs, and only active referenced products', async () => {
      const targets = await loadLinkTargets([
        moments([
          { type: 'shop', categoryId: category.id },
          { type: 'product', productId: active.id },
          { type: 'product', productId: hidden.id },
          { type: 'product', productId: UNKNOWN_ID },
        ]),
      ]);
      expect(targets.categories[category.id]).toBe(category.slug);
      expect(targets.products).toEqual({ [active.id]: active.slug });
    });

    it('follows a renamed slug, since links store the id', async () => {
      const values = [
        { ctaLink: { type: 'shop', categoryId: category.id } },
        { ctaLink: { type: 'product', productId: active.id } },
      ];
      await testDb
        .update(categories)
        .set({ slug: `${category.slug}-renamed` })
        .where(eq(categories.id, category.id));
      await testDb
        .update(products)
        .set({ slug: `${active.slug}-renamed` })
        .where(eq(products.id, active.id));
      try {
        const targets = await loadLinkTargets(values);
        expect(targets.categories[category.id]).toBe(
          `${category.slug}-renamed`,
        );
        expect(targets.products[active.id]).toBe(`${active.slug}-renamed`);
      } finally {
        await testDb
          .update(categories)
          .set({ slug: category.slug })
          .where(eq(categories.id, category.id));
        await testDb
          .update(products)
          .set({ slug: active.slug })
          .where(eq(products.id, active.id));
      }
    });

    it('uses categories the caller already loaded instead of reading them', async () => {
      const targets = await loadLinkTargets(
        [{ ctaLink: { type: 'shop', categoryId: UNKNOWN_ID } }],
        [{ id: UNKNOWN_ID, slug: 'given-slug' }],
      );
      expect(targets.categories).toEqual({ [UNKNOWN_ID]: 'given-slug' });
    });

    it('returns empty maps for blocks without a single link id', async () => {
      expect(
        await loadLinkTargets([
          DEFAULT_CONTENT['home.moments'],
          DEFAULT_CONTENT.header,
        ]),
      ).toEqual({ categories: {}, products: {} });
    });

    it('leaves the «انتخاب‌های اسموکی» picks out: they are cards, not links', async () => {
      // The home page reads its picks as cards on its own; resolving them here
      // too would fetch the same rows for slugs nothing renders.
      expect(
        await loadLinkTargets([recommends([active.id, head.id, null, null])]),
      ).toEqual({ categories: {}, products: {} });
    });
  });

  describe('findBrokenLinks', () => {
    it('passes a block whose every id resolves', async () => {
      expect(
        await findBrokenLinks(
          moments([
            { type: 'shop', categoryId: category.id, pet: 'cat' },
            { type: 'product', productId: active.id },
            { type: 'external', url: 'https://example.com/' },
          ]),
        ),
      ).toEqual([]);
      expect(await findBrokenLinks(routine([category.id]))).toEqual([]);
    });

    it('reports an unknown category and an unknown or hidden product on their paths', async () => {
      expect(
        await findBrokenLinks(
          moments([
            { type: 'shop', categoryId: category.id },
            { type: 'shop', categoryId: UNKNOWN_ID, pet: 'dog' },
            { type: 'product', productId: hidden.id },
            { type: 'product', productId: UNKNOWN_ID },
          ]),
        ),
      ).toEqual([
        `cards.1.link: ${LINK_MESSAGES.missingCategory}`,
        `cards.2.link: ${LINK_MESSAGES.missingProduct}`,
        `cards.3.link: ${LINK_MESSAGES.missingProduct}`,
      ]);
    });

    it('reports an unknown category among a routine tab’s picks', async () => {
      expect(await findBrokenLinks(routine([category.id, UNKNOWN_ID]))).toEqual(
        [`slots.0.categoryIds: ${LINK_MESSAGES.missingCategory}`],
      );
    });

    it('passes a «انتخاب‌های اسموکی» box holding a card the shop lists — a family by its head — and «خودکار» ones', async () => {
      expect(
        await findBrokenLinks(recommends([active.id, head.id, null, null])),
      ).toEqual([]);
    });

    it('refuses a box whose product the shop does not list as a card: hidden, unknown, or a family member', async () => {
      // The member is active, so a link may point at its page — but the shop
      // lists its family by the head, so a pick of it would never be shown.
      expect(
        await findBrokenLinks(
          recommends([hidden.id, UNKNOWN_ID, member.id, null]),
        ),
      ).toEqual([
        `productIds: ${LINK_MESSAGES.missingCard}`,
        `productIds: ${LINK_MESSAGES.missingCard}`,
        `productIds: ${LINK_MESSAGES.missingCard}`,
      ]);
    });

    it('still lets a product link point at a family member’s own page', async () => {
      expect(
        await findBrokenLinks(
          moments([{ type: 'product', productId: member.id }]),
        ),
      ).toEqual([]);
    });
  });
});
