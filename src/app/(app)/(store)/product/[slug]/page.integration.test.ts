// The product page's server data path. Needs a live database — see
// src/db/test-db.ts.
//
// The page is an async server component, so it can be called directly and its
// returned element tree inspected: no renderer, no component-test infrastructure
// (the repo has none), and the assertions stay on behaviour the story asks for
// — which product data reaches the page, and what a missing one does.
//
// `notFound()` works by throwing, so "renders the 404 page" is asserted as the
// documented `NEXT_HTTP_ERROR_FALLBACK;404` digest
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md).
// The interactive parts — gallery, tabs, stepper, drawer — are browser-verified;
// their pure logic lives in ../../../../features/storefront/product/availability.ts
// and is unit-tested there.
import { faker } from '@faker-js/faker';
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  PET_TYPES,
  productImages,
  products,
  type Category,
  type NewProduct,
} from '@/db/schema/catalog';
import { JsonLd } from '@/components/json-ld';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { formatToman } from '@/lib/format';
import { PATHS, shopPath } from '@/lib/constant/paths';
import { ProductGallery } from '@/features/storefront/product/product-gallery';
import {
  DELIVERY_NOTE,
  RETURN_NOTE,
} from '@/features/storefront/product/shop-policy';
import { rialForStructuredData } from '@/lib/seo';
import { SHOP_TITLE } from '@/features/storefront/shop/shop-metadata';

// The shop crumb reads whatever the shop page calls itself. A stand-in title
// shows this page takes it from there rather than typing a copy of its own.
vi.mock('@/features/storefront/shop/shop-metadata', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/storefront/shop/shop-metadata')
  >()),
  SHOP_TITLE: 'عنوان آزمایشی فروشگاه',
}));

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);
const page = await importWithDb(() => import('./page'));

/** The digest `notFound()` throws with, per the Next 16 docs. */
const NOT_FOUND_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK;404';

const render = (slug: string) =>
  page.default({ params: Promise.resolve({ slug }) });

/**
 * Every string in a returned element tree — text, `href`, `alt`, and the tab
 * panels the page passes to the tab strip as props.
 *
 * Walking props rather than only `children` is what reaches those panels: the
 * description and the specification rows are built by this server component and
 * handed to a client island, which is the whole point of the split. Class names
 * come along as strings too; the assertions below are written to be specific
 * enough not to care.
 */
function collect(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    found.push(String(node));
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;
  // Structured data is not what the page shows: a crumb that only it names
  // would satisfy a check meant for the visible trail.
  if ((node as { type?: unknown }).type === JsonLd) return found;

  // An element's strings live under `props`; the tab descriptors the page
  // builds are plain objects whose `content` holds a whole element of its own,
  // so those are walked by their own values.
  const props = (node as { props?: Record<string, unknown> }).props;
  for (const value of Object.values(props ?? (node as Record<string, unknown>)))
    collect(value, found);
  return found;
}

const renderedText = async (slug: string) => collect(await render(slug));

/**
 * The first element of type `component` in a rendered tree, keys and all.
 *
 * `collect` above flattens everything to strings, which is fine for copy and
 * useless for a `key` — and a key is exactly what the gallery needs pinned.
 */
function findElement(node: unknown, component: unknown): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, component);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;
  if ((node as { type?: unknown }).type === component) return node;
  const props = (node as { props?: Record<string, unknown> }).props;
  for (const value of Object.values(
    props ?? (node as Record<string, unknown>),
  )) {
    const hit = findElement(value, component);
    if (hit) return hit;
  }
  return null;
}

describe.skipIf(!databaseReachable)('the product page', () => {
  const createdCategoryIds: string[] = [];

  const makeCategory = async (
    parentId: string | null = null,
  ): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: parentId ? 'زیردسته آزمایشی' : 'دسته آزمایشی',
        slug: `test-${faker.string.alphanumeric(10).toLowerCase()}`,
        parentId,
      })
      .returning();
    createdCategoryIds.push(row.id);
    return row;
  };

  const makeProduct = (
    category: Category,
    overrides: Partial<NewProduct> = {},
  ): NewProduct => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return {
      title: 'غذای خشک آزمایشی گربه',
      slug: `test-${token}`,
      sku: `TEST-${token.toUpperCase()}`,
      brand: 'برند آزمایشی',
      benefit: 'مناسب گوارش حساس',
      description: 'توضیح کامل محصول برای صفحه محصول.',
      price: 285_000,
      stock: 24,
      categoryId: category.id,
      petTypes: [PET_TYPES.CAT],
      ...overrides,
    };
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
      await testDb.delete(products).where(inArray(products.id, ids));
    }
    await testDb
      .delete(categories)
      .where(inArray(categories.id, createdCategoryIds));
    createdCategoryIds.length = 0;
  });

  describe('a product that exists', () => {
    it('renders its title, brand and benefit line', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const text = await renderedText(product.slug);

      expect(text).toContain(product.title);
      expect(text).toContain('برند آزمایشی');
      expect(text).toContain('مناسب گوارش حساس');
    });

    it('states the delivery and return terms its structured data repeats', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const text = await renderedText(product.slug);

      expect(text).toContain(DELIVERY_NOTE);
      expect(text).toContain(RETURN_NOTE);
    });

    it('prices shipping in its structured data from the provinces’ fees', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      vi.spyOn(ShippingRateDao, 'listActive').mockResolvedValueOnce([
        { provinceId: 1, name: 'تهران', fee: 40_000 },
        { provinceId: 2, name: 'فارس', fee: 90_000 },
      ]);

      // The first JSON-LD on the page is the `Product`; the trail follows it.
      const jsonLd = findElement(await render(product.slug), JsonLd) as {
        props: { data: { offers: Record<string, unknown> } };
      };

      expect(jsonLd.props.data.offers).toHaveProperty(
        'shippingDetails.shippingRate',
        {
          '@type': 'MonetaryAmount',
          currency: 'IRR',
          maxValue: rialForStructuredData(90_000),
        },
      );
    });

    it('keys the gallery by product so it resets between products', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const gallery = findElement(await render(product.slug), ProductGallery);

      // Without this key React keeps the gallery's tree position across a
      // client-side move from one product page to another, and `active` — the
      // fourth photo, say — survives onto a product with a different gallery.
      // Pinned here rather than in E2E on purpose: `page.goto` is a full
      // document load, which resets the state with or without the fix, so a
      // navigation check would pass against the very bug it is meant to catch.
      expect(gallery).not.toBeNull();
      expect((gallery as { key?: unknown }).key).toBe(product.id);
    });

    it('names both pets in one phrase for a product suited to both', async () => {
      const category = await makeCategory();
      const both = await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.CAT, PET_TYPES.DOG] }),
      );
      const catOnly = await ProductDao.create(makeProduct(category));

      expect(await renderedText(both.slug)).toContain('گربه و سگ');
      const single = await renderedText(catOnly.slug);
      expect(single).toContain('گربه');
      expect(single).not.toContain('گربه و سگ');
    });

    it('renders the price in Toman with Persian digits', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 285_000 }),
      );

      const text = await renderedText(product.slug);

      expect(text).toContain(formatToman(285_000));
      expect(text.join(' ')).toContain('۲۸۵٬۰۰۰ تومان');
    });

    it('shows the old price when one is set', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 285_000, oldPrice: 320_000 }),
      );

      expect(await renderedText(product.slug)).toContain(formatToman(320_000));
    });

    it('shows no struck price when there is no old price', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 285_000, oldPrice: null }),
      );

      const text = await renderedText(product.slug);

      expect(text).toContain(formatToman(285_000));
      expect(text.filter((entry) => entry.endsWith('تومان'))).toEqual([
        formatToman(285_000),
      ]);
    });

    it('shows no price at all for a sold-out product', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 285_000, oldPrice: 320_000, stock: 0 }),
      );

      const text = await renderedText(product.slug);

      expect(text.filter((entry) => entry.endsWith('تومان'))).toEqual([]);
    });

    it('links the breadcrumb back into the shop, filtered by its category', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const text = await renderedText(product.slug);

      expect(text).toContain(shopPath({ category: category.slug }));
      expect(text).toContain(category.title);
    });

    it('names the shop crumb as the shop page names itself', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const text = await renderedText(product.slug);

      // Nothing else on a product page prints the shop's title.
      expect(text).toContain(SHOP_TITLE);
      expect(text).toContain(PATHS.SHOP);
    });

    it('puts the parent crumb before the sub-category’s, both linked', async () => {
      const parent = await makeCategory();
      const sub = await makeCategory(parent.id);
      const product = await ProductDao.create(makeProduct(sub));

      const text = await renderedText(product.slug);
      const crumbs = [
        text.indexOf(shopPath({ category: parent.slug })),
        text.indexOf(shopPath({ category: sub.slug })),
      ];

      expect(crumbs[0]).toBeGreaterThan(-1);
      expect(crumbs[1]).toBeGreaterThan(crumbs[0]);
      expect(text).toContain(parent.title);
      // The spec row names the category it is filed under — the sub — and the
      // breadcrumb above already carries the parent.
      expect(text).toContain(sub.title);
    });

    it('lists every category it is filed under, main first, each linked', async () => {
      const main = await makeCategory();
      const malt = await makeCategory();
      const multivitamin = await makeCategory();
      const product = await ProductDao.create({
        ...makeProduct(main),
        extraCategoryIds: [malt.id, multivitamin.id],
      });

      const text = await renderedText(product.slug);
      const paths = [main, malt, multivitamin].map((row) =>
        shopPath({ category: row.slug }),
      );

      for (const [index, row] of [main, malt, multivitamin].entries()) {
        expect(text).toContain(row.title);
        expect(text).toContain(paths[index]);
      }
      // The spec row renders the main one first: its link is the last of the
      // three to appear before them, since the breadcrumb already used it.
      expect(text.lastIndexOf(paths[0])).toBeLessThan(text.indexOf(paths[1]));
      expect(text.indexOf(paths[1])).toBeLessThan(text.indexOf(paths[2]));
      expect(text.filter((entry) => entry === 'product-category-link')).toEqual(
        Array(3).fill('product-category-link'),
      );
      expect(text).toContain('،');
    });

    it('leaves a single-category product’s row with one linked category', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const text = await renderedText(product.slug);

      expect(text).toContain(category.title);
      expect(text.filter((entry) => entry === 'product-category-link')).toEqual(
        ['product-category-link'],
      );
      expect(text).not.toContain('،');
    });

    it('renders its description', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { description: 'یک توضیح یکتا برای این تست.' }),
      );

      expect(await renderedText(product.slug)).toContain(
        'یک توضیح یکتا برای این تست.',
      );
    });

    // Every seeded product has a null description today, so the fallback is
    // the state a reviewer actually sees — it must be copy, not an empty gap.
    it('falls back to copy when the product has no description', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { description: null }),
      );

      const text = await renderedText(product.slug).then((t) => t.join(' '));

      expect(text).toContain('توضیحاتی برای این محصول ثبت نشده');
    });

    it('renders without a gallery image rather than failing', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      await expect(render(product.slug)).resolves.toBeTruthy();
    });

    it('titles the document with the product', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const metadata = await page.generateMetadata({
        params: Promise.resolve({ slug: product.slug }),
      });

      expect(metadata.title).toBe(product.title);
    });
  });

  describe('a product that is not there', () => {
    it('404s an unknown slug', async () => {
      await expect(render('nothing-here-at-all')).rejects.toMatchObject({
        digest: expect.stringContaining(NOT_FOUND_DIGEST),
      });
    });

    // The API layer makes inactive indistinguishable from missing; the page
    // has to keep that property rather than rendering a hidden product.
    it('404s a soft-deleted product', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(product.id);

      await expect(render(product.slug)).rejects.toMatchObject({
        digest: expect.stringContaining(NOT_FOUND_DIGEST),
      });
    });

    it('404s rather than throwing on a slug that is not a usable string', async () => {
      await expect(render('' as unknown as string)).rejects.toMatchObject({
        digest: expect.stringContaining(NOT_FOUND_DIGEST),
      });
      await expect(
        render(undefined as unknown as string),
      ).rejects.toMatchObject({
        digest: expect.stringContaining(NOT_FOUND_DIGEST),
      });
    });

    // The 404 page owns the title here. Anything this route returns would win
    // over it and label the not-found page as a product.
    it('claims no title for a missing product', async () => {
      const metadata = await page.generateMetadata({
        params: Promise.resolve({ slug: 'nothing-here-at-all' }),
      });

      expect(metadata.title).toBeUndefined();
    });
  });
});
