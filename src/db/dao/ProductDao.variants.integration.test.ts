// Product families — needs a live database (see src/db/test-db.ts).
//
// Every assertion here is about a rule that spans two rows, which is exactly
// what a mocked `db` cannot prove: «one level deep», «the head still exists»,
// «this head still has members», and the three family scalars the storefront
// card reads. The one-row rules (a member must carry a label, no self-parent)
// are CHECK constraints and are proven here too, because a CHECK is also
// something only a real database enforces.
import { faker } from '@faker-js/faker';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  categories,
  PET_TYPES,
  productImages,
  products,
  type Category,
  type NewProduct,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { VARIANT_MESSAGES, hasMembersMessage } from '@/lib/catalog/variant';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

/**
 * ZERO WIDTH NON-JOINER, constructed rather than typed — the repo's
 * control-character rule. A raw one here would be invisible in the diff and in
 * review, which is exactly how it got past three guards in the first place.
 */
const ZWNJ = String.fromCharCode(0x200c);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!databaseReachable)('ProductDao — product families', () => {
  const createdCategoryIds: string[] = [];

  const makeCategory = async (): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'دسته آزمایشی',
        slug: `tvar-${faker.string.alphanumeric(10).toLowerCase()}`,
      })
      .returning();
    createdCategoryIds.push(row.id);
    return row;
  };

  const productValues = (
    category: Category,
    overrides: Partial<NewProduct> = {},
  ): NewProduct => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return {
      title: 'غذای خشک سگ',
      slug: `tvar-${token}`,
      sku: `TVAR-${token.toUpperCase()}`,
      price: 100_000,
      stock: 5,
      categoryId: category.id,
      petTypes: [PET_TYPES.DOG],
      ...overrides,
    };
  };

  /** Inserts straight through drizzle — the DAO's own guards are tested apart. */
  const insert = async (
    category: Category,
    overrides: Partial<NewProduct> = {},
  ) => {
    const [row] = await testDb
      .insert(products)
      .values(productValues(category, overrides))
      .returning();
    return row;
  };

  afterEach(async () => {
    if (createdCategoryIds.length === 0) return;
    const mine = await testDb
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.categoryId, createdCategoryIds));
    const ids = mine.map((row) => row.id);
    if (ids.length > 0) {
      await testDb
        .delete(productImages)
        .where(inArray(productImages.productId, ids));
      // Members first: `variant_of` restricts, so a head cannot go while one of
      // its members still points at it. That ordering is itself the proof that
      // the foreign key is doing its job.
      await testDb
        .delete(products)
        .where(and(inArray(products.id, ids), isNotNull(products.variantOf)));
      await testDb.delete(products).where(inArray(products.id, ids));
    }
    await testDb
      .delete(categories)
      .where(inArray(categories.id, createdCategoryIds));
    createdCategoryIds.length = 0;
  });

  describe('the storefront lists one card per family', () => {
    it('lists the head and hides its members', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
      // The count comes from a second query over the same where clause; if the
      // predicate reached only the page query this would read 2.
      expect(total).toBe(1);
    });

    it('still lists a standalone product', async () => {
      const category = await makeCategory();
      const alone = await insert(category);

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(items.map((item) => item.id)).toEqual([alone.id]);
      expect(total).toBe(1);
    });

    it('hides members from the pet filter too, not just the category one', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: 'قرمز' });
      await insert(category, { variantOf: head.id, variantLabel: 'آبی' });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        petType: PET_TYPES.DOG,
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
    });

    // Constructed with raw inserts on purpose: this is the state the DAO now
    // refuses to *create* (see «hiding a head» below), and the point here is
    // that if one ever exists — a hand-edited row, a restored backup — the
    // listing still hides the member rather than leaking a half-family.
    // Read it as damage control, not as an outcome worth reaching.
    it('hides a member whose head is inactive, if such a row exists at all', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        variantLabel: 'قرمز',
        isActive: false,
      });
      await insert(category, { variantOf: head.id, variantLabel: 'آبی' });

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(items).toEqual([]);
      expect(total).toBe(0);
    });
  });

  describe('the family scalars the card reads', () => {
    it('reports the family minimum price, not the head price', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 450_000,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        price: 250_000,
        variantOf: head.id,
        variantLabel: '۵ کیلوگرم',
      });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(items[0].familyMinPrice).toBe(250_000);
      expect(items[0].familyPricesVary).toBe(true);
    });

    it('reports «does not vary» when every member costs the same', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 250_000,
        variantLabel: 'لاوندر',
      });
      await insert(category, {
        price: 250_000,
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyMinPrice).toBe(250_000);
      expect(items[0].familyPricesVary).toBe(false);
    });

    it('a standalone product reports its own price and no variation', async () => {
      const category = await makeCategory();
      await insert(category, { price: 99_000 });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyMinPrice).toBe(99_000);
      expect(items[0].familyPricesVary).toBe(false);
    });

    it('is in stock when a member is, even though the head is sold out', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        stock: 0,
        variantLabel: '۵ کیلوگرم',
      });
      await insert(category, {
        stock: 7,
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyInStock).toBe(true);
    });

    it('reports that a family has members even when the prices agree', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 250_000,
        variantLabel: 'لاوندر',
      });
      await insert(category, {
        price: 250_000,
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      // The card must send the shopper to the page to choose a smell, even
      // though there is no «از …» to print.
      expect(items[0].familyHasMembers).toBe(true);
      expect(items[0].familyPricesVary).toBe(false);
    });

    it('reports no members for a standalone product', async () => {
      const category = await makeCategory();
      await insert(category);

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyHasMembers).toBe(false);
    });

    it('reports no members once the only member is inactive', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: 'لاوندر' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
        isActive: false,
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      // Nothing left to choose between, so the card adds to the cart again.
      expect(items[0].familyHasMembers).toBe(false);
    });

    it('is out of stock when every member is', async () => {
      const category = await makeCategory();
      const head = await insert(category, { stock: 0, variantLabel: 'قرمز' });
      await insert(category, {
        stock: 0,
        variantOf: head.id,
        variantLabel: 'آبی',
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyInStock).toBe(false);
    });

    it('ignores an inactive member in both scalars', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 450_000,
        stock: 0,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        price: 250_000,
        stock: 9,
        isActive: false,
        variantOf: head.id,
        variantLabel: '۵ کیلوگرم',
      });

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items[0].familyMinPrice).toBe(450_000);
      expect(items[0].familyPricesVary).toBe(false);
      expect(items[0].familyInStock).toBe(false);
    });
  });

  describe('price sorting and the price range read the family', () => {
    it('sorts on the family minimum, so the order matches the printed price', async () => {
      const category = await makeCategory();
      const cheapAlone = await insert(category, { price: 300_000 });
      const expensiveHead = await insert(category, {
        price: 900_000,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        price: 100_000,
        variantOf: expensiveHead.id,
        variantLabel: '۵ کیلوگرم',
      });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
      });

      // The family's own cheapest is 100_000, so it leads — sorting on the
      // head's 900_000 would put it second and disagree with «از ۱۰۰٬۰۰۰».
      expect(items.map((item) => item.id)).toEqual([
        expensiveHead.id,
        cheapAlone.id,
      ]);
    });

    it('keeps a family whose printed «از» price is inside the range', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 450_000,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        price: 250_000,
        variantOf: head.id,
        variantLabel: '۵ کیلوگرم',
      });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        maxPrice: 300_000,
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
    });

    it('keeps a family whose dearer member is inside the range', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 250_000,
        variantLabel: '۵ کیلوگرم',
      });
      await insert(category, {
        price: 450_000,
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 400_000,
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
    });

    it('drops a family that is wholly outside the range', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 250_000,
        variantLabel: '۵ کیلوگرم',
      });
      await insert(category, {
        price: 450_000,
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 600_000,
      });

      expect(items).toEqual([]);
      expect(total).toBe(0);
    });

    it('drops a family that straddles the window with nothing inside it', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 185_000,
        variantLabel: 'لاوندر',
      });
      await insert(category, {
        price: 149_000,
        variantOf: head.id,
        variantLabel: 'بدون بو',
      });

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 160_000,
        maxPrice: 170_000,
      });

      // Nothing in this family costs between ۱۶۰٬۰۰۰ and ۱۷۰٬۰۰۰. Two
      // comparisons — «the dearest is above the floor» and «the cheapest is
      // below the ceiling» — are both true here and were satisfied by two
      // different members, which put the card on a shelf where a shopper who
      // set a budget could buy nothing on it.
      expect(items).toEqual([]);
      expect(total).toBe(0);
    });

    it('keeps it once the window reaches one of the members', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 185_000,
        variantLabel: 'لاوندر',
      });
      await insert(category, {
        price: 149_000,
        variantOf: head.id,
        variantLabel: 'بدون بو',
      });

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 140_000,
        maxPrice: 170_000,
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
    });
  });

  describe('search reaches a family through its members', () => {
    it("puts a member's label into that member's own search text", async () => {
      const category = await makeCategory();
      const head = await ProductDao.create(
        productValues(category, { variantLabel: '۵ کیلوگرم' }),
      );
      const member = await ProductDao.create(
        productValues(category, {
          variantOf: head.id,
          variantLabel: 'ویژه توله سگ',
        }),
      );

      const [row] = await testDb
        .select({ searchText: products.searchText })
        .from(products)
        .where(eq(products.id, member.id));

      expect(row.searchText).toContain('توله');
    });

    it('finds the head when only a member matches the term', async () => {
      const category = await makeCategory();
      const head = await ProductDao.create(
        productValues(category, {
          title: 'شامپو سگ',
          variantLabel: 'معمولی',
        }),
      );
      await ProductDao.create(
        productValues(category, {
          title: 'شامپو سگ',
          variantOf: head.id,
          variantLabel: 'ضدکک',
        }),
      );

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        search: 'ضدکک',
      });

      expect(items.map((item) => item.id)).toEqual([head.id]);
    });

    it('does not surface the member itself as a second card', async () => {
      const category = await makeCategory();
      const head = await ProductDao.create(
        productValues(category, { title: 'شامپو سگ', variantLabel: 'معمولی' }),
      );
      await ProductDao.create(
        productValues(category, {
          title: 'شامپو سگ',
          variantOf: head.id,
          variantLabel: 'ضدکک',
        }),
      );

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        search: 'شامپو',
      });

      expect(items).toHaveLength(1);
      expect(total).toBe(1);
    });
  });

  describe('the product page resolves a member and its siblings', () => {
    it('resolves a member by its own slug', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const found = await ProductDao.getBySlug(member.slug);

      expect(found?.id).toBe(member.id);
    });

    it('returns the whole family, head first, from a member', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const found = await ProductDao.getBySlug(member.slug);

      expect(found?.variants.map((v) => v.id)).toEqual([head.id, member.id]);
      expect(found?.variants.map((v) => v.label)).toEqual([
        '۵ کیلوگرم',
        '۱۰ کیلوگرم',
      ]);
    });

    it('returns the same family from the head', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const found = await ProductDao.getBySlug(head.slug);

      expect(found?.variants.map((v) => v.id)).toEqual([head.id, member.id]);
    });

    it('carries each member’s own price and stock onto its chip', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 185_000,
        stock: 4,
        variantLabel: 'لاوندر',
      });
      await insert(category, {
        price: 149_000,
        stock: 0,
        variantOf: head.id,
        variantLabel: 'بدون بو',
      });

      const found = await ProductDao.getBySlug(head.slug);

      // The card advertises the family's cheapest member, so the page it links
      // to has to say which member that is — and that it is sold out.
      expect(found?.variants.map((v) => [v.price, v.inStock])).toEqual([
        [185_000, true],
        [149_000, false],
      ]);
    });

    it('gives a standalone product an empty family, so the page shows no chips', async () => {
      const category = await makeCategory();
      const alone = await insert(category);

      const found = await ProductDao.getBySlug(alone.slug);

      expect(found?.variants).toEqual([]);
    });

    it('leaves an inactive member out of the chips', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۲۰ کیلوگرم',
        isActive: false,
      });

      const found = await ProductDao.getBySlug(head.slug);

      // A chip leading to a soft-deleted product is a chip leading to a 404.
      expect(found?.variants.map((v) => v.label)).toEqual([
        '۵ کیلوگرم',
        '۱۰ کیلوگرم',
      ]);
    });

    it('shows no chips when the only sibling left is inactive', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
        isActive: false,
      });

      const found = await ProductDao.getBySlug(head.slug);

      // One chip, already selected, offers the shopper no choice — so the page
      // shows none at all, exactly as a standalone product does.
      expect(found?.variants).toEqual([]);
    });
  });

  describe('the guards that need to read another row', () => {
    it('refuses a second level', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      await expect(
        ProductDao.create(
          productValues(category, {
            variantOf: member.id,
            variantLabel: '۲۰ کیلوگرم',
          }),
        ),
      ).rejects.toThrow(VARIANT_MESSAGES.nested);
    });

    it('refuses a head that has no label of its own', async () => {
      const category = await makeCategory();
      const bare = await insert(category);

      await expect(
        ProductDao.create(
          productValues(category, {
            variantOf: bare.id,
            variantLabel: '۱۰ کیلوگرم',
          }),
        ),
      ).rejects.toThrow(VARIANT_MESSAGES.headNeedsLabel);
    });

    it('refuses hanging a member off a soft-deleted head', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        variantLabel: '۵ کیلوگرم',
        isActive: false,
      });

      // The mirror image of the `hasMembers` refusal, and the same bad row at
      // the end of it: the storefront drops the head for `is_active` and never
      // listed the members for `variant_of is null`, so this member would be
      // live and buyable by URL while appearing on no shelf at all.
      await expect(
        ProductDao.create(
          productValues(category, {
            variantOf: head.id,
            variantLabel: '۱۰ کیلوگرم',
          }),
        ),
      ).rejects.toThrow(VARIANT_MESSAGES.inactiveHead);
    });

    it('refuses moving an existing product under a soft-deleted head', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        variantLabel: '۵ کیلوگرم',
        isActive: false,
      });
      const loner = await insert(category);

      await expect(
        ProductDao.update(loner.id, {
          variantOf: head.id,
          variantLabel: '۱۰ کیلوگرم',
        }),
      ).rejects.toThrow(VARIANT_MESSAGES.inactiveHead);
    });

    it('waits on a member being attached before it counts the members', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });

      // The race that orphans a family: «attach a member» beside «hide the
      // head». Each write is legal on its own, and neither sees the other.
      //
      // Postgres does not close it for free. A transaction writing a member
      // holds `for key share` on the head — the lock its foreign key takes —
      // and a plain `update products set is_active = false` asks only for
      // `for no key update`, which does **not** conflict with it. So both
      // commit, and the shop ends up with an active product hanging off a
      // hidden one, listed nowhere and buyable by URL.
      //
      // The other connection here holds exactly that foreign-key lock. Hiding
      // the head must not get past its guard until the attach is done, which
      // is what the recorded order proves — and `for key share` is why the
      // guard has to ask for `for update` rather than merely reading.
      const order: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const attaching = testDb.transaction(async (tx) => {
        await tx.execute(
          sql`select id from products where id = ${head.id} for key share`,
        );
        await held;
      });
      await sleep(50);

      const hide = ProductDao.update(head.id, { isActive: false }).then(() =>
        order.push('hidden'),
      );

      await sleep(200);
      order.push('released');
      release();
      await attaching;
      await hide;

      expect(order).toEqual(['released', 'hidden']);
    });

    it('refuses a head that does not exist', async () => {
      const category = await makeCategory();

      await expect(
        ProductDao.create(
          productValues(category, {
            variantOf: '00000000-0000-4000-8000-000000000000',
            variantLabel: '۱۰ کیلوگرم',
          }),
        ),
      ).rejects.toThrow(VARIANT_MESSAGES.unknownHead);
    });

    it('refuses making a product its own head on update', async () => {
      const category = await makeCategory();
      const alone = await insert(category, { variantLabel: 'قرمز' });

      await expect(
        ProductDao.update(alone.id, { variantOf: alone.id }),
      ).rejects.toThrow(VARIANT_MESSAGES.self);
    });

    it('refuses turning a head that already has members into a member', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });
      const other = await insert(category, { variantLabel: 'دیگر' });

      await expect(
        ProductDao.update(head.id, { variantOf: other.id }),
      ).rejects.toThrow(VARIANT_MESSAGES.nested);
    });

    it('refuses soft-deleting a head that still has members', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      await expect(ProductDao.softDelete(head.id)).rejects.toThrow(
        hasMembersMessage(1),
      );
    });

    it('allows soft-deleting a head once its members are gone', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });
      await testDb.delete(products).where(eq(products.id, member.id));

      const deleted = await ProductDao.softDelete(head.id);

      expect(deleted?.isActive).toBe(false);
    });

    it('still allows soft-deleting an ordinary member', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const deleted = await ProductDao.softDelete(member.id);

      expect(deleted?.isActive).toBe(false);
    });

    it('names how many active members are in the way', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۲۰ کیلوگرم',
      });

      // «برخی» would send an admin hunting; the count says how many.
      await expect(ProductDao.softDelete(head.id)).rejects.toThrow(
        hasMembersMessage(2),
      );
    });

    it('refuses to hide a head with active members through update() too', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      // The edit form's «نمایش در فروشگاه» checkbox writes `isActive` through
      // `update`, not `softDelete`. Before the guard was shared, «حذف» refused
      // and this door accepted — leaving the members active, purchasable by
      // URL, and listed on no shelf.
      await expect(
        ProductDao.update(head.id, { isActive: false }),
      ).rejects.toThrow(hasMembersMessage(1));

      const [row] = await testDb
        .select({ isActive: products.isActive })
        .from(products)
        .where(eq(products.id, head.id));
      expect(row.isActive).toBe(true);
    });

    it('lets update() hide a head whose members are already inactive', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
        isActive: false,
      });

      const updated = await ProductDao.update(head.id, { isActive: false });

      expect(updated?.isActive).toBe(false);
    });

    it('leaves an ordinary product free to be hidden', async () => {
      const category = await makeCategory();
      const alone = await insert(category);

      const updated = await ProductDao.update(alone.id, { isActive: false });

      expect(updated?.isActive).toBe(false);
    });

    it('lets a head go once its members are only inactive', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
        isActive: false,
      });

      // Counting inactive members too would be a dead end: deactivate every
      // size and the head could never follow them, since the rows still point
      // at it. Neither is listed anywhere, so there is nothing to protect.
      const deleted = await ProductDao.softDelete(head.id);

      expect(deleted?.isActive).toBe(false);
    });

    it('refuses to clear a head\u2019s own label while it has active members', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      // The CHECK covers members only, and the «head needs a label» guard fires
      // only when something is pointed *at* it — so without this the head's own
      // chip would render blank.
      await expect(
        ProductDao.update(head.id, { variantLabel: null }),
      ).rejects.toThrow(VARIANT_MESSAGES.headNeedsLabel);
    });

    it('lets a standalone product clear its label freely', async () => {
      const category = await makeCategory();
      const alone = await insert(category, { variantLabel: 'قرمز' });

      const updated = await ProductDao.update(alone.id, {
        variantLabel: null,
      });

      expect(updated?.variantLabel).toBeNull();
    });
  });

  describe('the «زیرمجموعه‌ی» options the edit form renders', () => {
    const idsFor = async (exclude?: string, current?: string | null) =>
      (await ProductDao.listVariantHeads(exclude, current)).map(
        (head) => head.id,
      );

    it('offers the heads and standalone products, never the members', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });
      const alone = await insert(category);

      const offered = await idsFor();

      expect(offered).toContain(head.id);
      expect(offered).toContain(alone.id);
      // One level: a member cannot be somebody else's head.
      expect(offered).not.toContain(member.id);
    });

    it('never offers the row being edited as its own head', async () => {
      const category = await makeCategory();
      const alone = await insert(category);

      expect(await idsFor(alone.id)).not.toContain(alone.id);
    });

    it('leaves a soft-deleted product out of the options', async () => {
      const category = await makeCategory();
      const hidden = await insert(category, { isActive: false });

      expect(await idsFor()).not.toContain(hidden.id);
    });

    it('still offers the soft-deleted head this row already points at', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        variantLabel: '۵ کیلوگرم',
        isActive: false,
      });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
        isActive: false,
      });

      // The select mirrors `variant_of`. Drop the stored head from the options
      // and the form reads «هیچ‌کدام — محصول مستقل» for a row that is nothing
      // of the sort — and saving it, which an admin might do after editing the
      // price, detaches the product silently.
      expect(await idsFor(member.id, member.variantOf)).toContain(head.id);
    });
  });

  describe('re-seeding a family', () => {
    it('carries a corrected label onto the row, not only into its search text', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = productValues(category, {
        variantOf: head.id,
        variantLabel: 'لاوندر',
      });
      await ProductDao.upsertBySku(member);

      const corrected = await ProductDao.upsertBySku({
        ...member,
        variantLabel: 'اقیانوس',
      });

      // The conflict `set` rebuilt `search_text` — which is built FROM the
      // label — while leaving the label itself at whatever the first run
      // inserted. The row then answered a search for a word its own page never
      // showed, and no re-run could ever put it right.
      expect(corrected.variantLabel).toBe('اقیانوس');
      const [row] = await testDb
        .select({ searchText: products.searchText })
        .from(products)
        .where(eq(products.id, corrected.id));
      expect(row.searchText).toContain('اقیانوس');
      expect(row.searchText).not.toContain('لاوندر');
    });

    it('re-attaches a product the seed moved into a family', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const input = productValues(category);
      const standalone = await ProductDao.upsertBySku(input);
      expect(standalone.variantOf).toBeNull();

      const attached = await ProductDao.upsertBySku({
        ...input,
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      // A family broken once had no way back: the seed is the truth about the
      // catalogue's shape, so a re-run has to be able to correct it.
      expect(attached.id).toBe(standalone.id);
      expect(attached.variantOf).toBe(head.id);
    });
  });

  describe('the one-row rules the database itself enforces', () => {
    it('refuses a member with a whitespace-only label', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });

      await expect(
        testDb
          .insert(products)
          .values(
            productValues(category, { variantOf: head.id, variantLabel: '  ' }),
          ),
      ).rejects.toThrow();
    });

    it('refuses a member carrying no label at all', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });

      // The one value the old constraint could not refuse: a CHECK passes when
      // it evaluates to NULL, and `length(btrim(null)) > 0` is NULL — so the
      // rule about a missing label was satisfied by the label being missing.
      await expect(
        testDb.insert(products).values(
          productValues(category, {
            variantOf: head.id,
            variantLabel: null,
          }),
        ),
      ).rejects.toThrow();
    });

    it('refuses a label made of nothing but ZWNJ', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });

      // ZWNJ is the hole every other guard leaves open: `FORBIDDEN_TEXT_CHARS`
      // allows it on purpose, and neither `trim()` nor `btrim` removes it — so
      // this reached the column as a label that renders as an empty chip.
      await expect(
        testDb.insert(products).values(
          productValues(category, {
            variantOf: head.id,
            variantLabel: ZWNJ + ZWNJ,
          }),
        ),
      ).rejects.toThrow();
    });

    it('still accepts a Persian label that needs a ZWNJ inside it', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });

      // The other half of the rule, and the reason it strips rather than
      // forbids: «بی‌بو» is a word, and the seed ships it.
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: `بی${ZWNJ}بو`,
      });

      expect(member.variantLabel).toBe(`بی${ZWNJ}بو`);
    });

    it('refuses a row that points at itself', async () => {
      const category = await makeCategory();
      const alone = await insert(category, { variantLabel: 'قرمز' });

      await expect(
        testDb
          .update(products)
          .set({ variantOf: alone.id })
          .where(eq(products.id, alone.id)),
      ).rejects.toThrow();
    });

    it('refuses hard-deleting a head while a member points at it', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      await expect(
        testDb.delete(products).where(eq(products.id, head.id)),
      ).rejects.toThrow();
    });
  });

  describe('nothing about an ordinary product changed', () => {
    it('leaves both columns null on a product created without them', async () => {
      const category = await makeCategory();
      const created = await ProductDao.create(productValues(category));

      expect(created.variantOf).toBeNull();
      expect(created.variantLabel).toBeNull();
    });

    it('still lists products that predate the columns', async () => {
      const category = await makeCategory();
      await insert(category);
      await insert(category);

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(items).toHaveLength(2);
      expect(total).toBe(2);
      expect(items.every((item) => item.variantOf === null)).toBe(true);
    });

    it('keeps the heads-and-standalone predicate off the admin listing', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      // An admin must be able to find and edit the 10kg bag.
      const rows = await ProductDao.listForAdmin({
        categorySlug: category.slug,
      });

      expect(rows).toHaveLength(2);
    });

    it('keeps getByIds blind to the predicate, so checkout can reprice a member', async () => {
      const category = await makeCategory();
      const head = await insert(category, { variantLabel: '۵ کیلوگرم' });
      const member = await insert(category, {
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      const loaded = await ProductDao.getByIds(testDb, [head.id, member.id]);

      expect(loaded.map((row) => row.id).sort()).toEqual(
        [head.id, member.id].sort(),
      );
    });
  });

  describe('priceBounds', () => {
    it('spans the cheapest and dearest active product', async () => {
      const category = await makeCategory();
      await insert(category, { price: 77_000 });
      await insert(category, { price: 910_000 });

      const { min, max } = await ProductDao.priceBounds();

      // The dev database holds the seed too, so these are bounds, not equality:
      // what must hold is that the slider can reach every price on the shelf.
      expect(min).toBeLessThanOrEqual(77_000);
      expect(max).toBeGreaterThanOrEqual(910_000);
    });

    it('reaches a family member, not just the heads', async () => {
      const category = await makeCategory();
      const head = await insert(category, {
        price: 500_000,
        variantLabel: '۵ کیلوگرم',
      });
      await insert(category, {
        price: 3_300_000,
        variantOf: head.id,
        variantLabel: '۱۰ کیلوگرم',
      });

      // The card prints the family's cheapest and the member's own page its own
      // price, so a slider stopping at the heads could not reach either.
      expect((await ProductDao.priceBounds()).max).toBeGreaterThanOrEqual(
        3_300_000,
      );
    });

    it('returns numbers, not the strings pg gives for a bigint aggregate', async () => {
      const { min, max } = await ProductDao.priceBounds();

      expect(typeof min).toBe('number');
      expect(typeof max).toBe('number');
    });
  });

  it('never lists a member, whatever the filters say', async () => {
    const category = await makeCategory();
    const head = await insert(category, { variantLabel: 'لاوندر' });
    await insert(category, { variantOf: head.id, variantLabel: 'اقیانوس' });

    const asMembers = await testDb
      .select({ id: products.id })
      .from(products)
      .where(isNull(products.variantOf));

    // A sanity check on the fixture itself: the head is among the null rows and
    // the member is not, so the predicate above is the one under test.
    expect(asMembers.some((row) => row.id === head.id)).toBe(true);
  });
});
