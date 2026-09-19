// No database needed — `@/db` is mocked, as in UserDao.test.ts. The behaviour
// of these methods is covered against a real Postgres in
// ./ProductDao.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));

const { ProductDao, buildProductSearchText } = await import('./ProductDao');

describe('ProductDao — the soft-delete contract', () => {
  it('exposes no hard-delete method at all', () => {
    // The AC is about the shape of the surface, not only its behaviour: if no
    // caller *can* hard-delete a product, no order item can ever be orphaned
    // from the row whose title, sku and unit price it snapshotted. A future
    // `deleteById` here fails this test rather than quietly shipping.
    const removers = Object.getOwnPropertyNames(ProductDao).filter((name) =>
      /delete|destroy|remove|purge|drop/i.test(name),
    );

    expect(removers).toEqual(['softDelete']);
  });
});

// Which fields a product is findable by is a product decision, and it holds
// without a database — so it is pinned here rather than only in the integration
// suite, where it would go untested on a machine with no Postgres.
describe('buildProductSearchText — what a shopper can find a product by', () => {
  it('joins the title, brand and benefit', () => {
    expect(
      buildProductSearchText({
        title: 'غذای خشک گربه',
        brand: 'Royal Canin',
        benefit: 'گوارش حساس',
      }),
    ).toBe('غذای خشک گربه Royal Canin گوارش حساس');
  });

  it('normalizes the joined text', () => {
    // Arabic yeh and kaf in the title, ZWNJ in the benefit: one pass over the
    // whole string, the same one the search term goes through.
    expect(
      buildProductSearchText({
        title: 'غذاي خشك',
        brand: null,
        benefit: 'اسباب‌بازی',
      }),
    ).toBe('غذای خشک اسباب بازی');
  });

  it('leaves out a missing brand without leaving a gap behind', () => {
    expect(
      buildProductSearchText({
        title: 'غذای خشک',
        brand: null,
        benefit: 'گوارش حساس',
      }),
    ).toBe('غذای خشک گوارش حساس');
  });

  it('treats an empty brand as a missing one', () => {
    expect(
      buildProductSearchText({ title: 'غذای خشک', brand: '', benefit: null }),
    ).toBe('غذای خشک');
  });

  it('is just the title when there is nothing else', () => {
    expect(
      buildProductSearchText({ title: 'غذای خشک', brand: null, benefit: null }),
    ).toBe('غذای خشک');
  });

  it('carries a family member’s own «نوع», so its size is searchable', () => {
    // The reason `variantLabel` is in `SEARCHABLE_FIELDS` at all: a member's
    // row is what «۱۰ کیلوگرم» has to match, since nothing rewrites the head's
    // text when a member changes. Pinned here rather than only in the
    // database-backed suite, which skips on a machine with no Postgres.
    expect(
      buildProductSearchText({
        title: 'غذای خشک سگ',
        brand: null,
        benefit: null,
        variantLabel: '۱۰ کیلوگرم',
      }),
      // Folded to ASCII digits by the same normalization the search term goes
      // through, so «10 کیلو» and «۱۰ کیلو» both find it.
    ).toBe('غذای خشک سگ 10 کیلوگرم');
  });

  it('leaves a standalone product’s text exactly as it was', () => {
    // The columns are nullable and most products have neither, so adding the
    // field must not change a single existing row's search text.
    expect(
      buildProductSearchText({
        title: 'غذای خشک سگ',
        brand: 'Royal Canin',
        benefit: null,
        variantLabel: null,
      }),
    ).toBe('غذای خشک سگ Royal Canin');
  });

  it('excludes the description, which is prose and would bury the title', () => {
    const text = buildProductSearchText({
      title: 'غذای خشک',
      brand: null,
      benefit: null,
      description: 'یک توضیح بسیار طولانی درباره ترکیبات و نحوه نگهداری',
    } as Parameters<typeof buildProductSearchText>[0]);

    expect(text).toBe('غذای خشک');
  });
});
