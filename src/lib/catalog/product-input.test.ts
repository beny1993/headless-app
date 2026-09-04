import { describe, expect, it } from 'vitest';
import { PET_TYPES } from './product-query';
import { productInputSchema } from './product-input';

const valid = {
  title: 'غذای خشک گربه',
  slug: 'royal-canin-adult-cat',
  sku: 'RC-ADULT-CAT-2KG',
  brand: 'رویال کنین',
  description: 'توضیح کامل محصول.',
  benefit: 'مناسب گوارش حساس',
  price: 2_450_000,
  oldPrice: 2_900_000,
  stock: 12,
  categoryId: '123e4567-e89b-12d3-a456-426614174000',
  petType: PET_TYPES.CAT,
  isActive: true,
};

describe('productInputSchema', () => {
  it('accepts a well-formed product', () => {
    const parsed = productInputSchema.parse(valid);
    expect(parsed.price).toBe(2_450_000);
    expect(parsed.petType).toBe('cat');
  });

  describe('money is integer Toman', () => {
    it('rejects a zero or negative price', () => {
      expect(productInputSchema.safeParse({ ...valid, price: 0 }).success).toBe(
        false,
      );
      expect(
        productInputSchema.safeParse({ ...valid, price: -1 }).success,
      ).toBe(false);
    });

    it('rejects a fractional price — Toman has no decimals', () => {
      expect(
        productInputSchema.safeParse({ ...valid, price: 1999.99 }).success,
      ).toBe(false);
    });

    it('rejects a price past the safe-integer ceiling (no precision loss)', () => {
      expect(
        productInputSchema.safeParse({
          ...valid,
          oldPrice: null,
          price: Number.MAX_SAFE_INTEGER + 2,
        }).success,
      ).toBe(false);
    });

    it('allows stock of zero but rejects negative stock', () => {
      expect(productInputSchema.safeParse({ ...valid, stock: 0 }).success).toBe(
        true,
      );
      expect(
        productInputSchema.safeParse({ ...valid, stock: -1 }).success,
      ).toBe(false);
    });
  });

  describe('oldPrice cross-field rule', () => {
    it('rejects an oldPrice at or below the price', () => {
      const at = productInputSchema.safeParse({
        ...valid,
        oldPrice: valid.price,
      });
      const below = productInputSchema.safeParse({
        ...valid,
        oldPrice: valid.price - 1,
      });
      expect(at.success).toBe(false);
      expect(below.success).toBe(false);
      if (!at.success) {
        expect(at.error.issues[0].path).toEqual(['oldPrice']);
      }
    });

    it('treats a null/absent oldPrice as "no discount"', () => {
      expect(
        productInputSchema.safeParse({ ...valid, oldPrice: null }).success,
      ).toBe(true);
      const { oldPrice, ...withoutOldPrice } = valid;
      void oldPrice;
      expect(productInputSchema.safeParse(withoutOldPrice).success).toBe(true);
    });
  });

  describe('slug', () => {
    it('rejects uppercase, spaces and Persian characters', () => {
      for (const slug of ['Royal-Canin', 'royal canin', 'رویال', 'ab']) {
        expect(productInputSchema.safeParse({ ...valid, slug }).success).toBe(
          false,
        );
      }
    });
  });

  describe('server-owned fields', () => {
    it('strips id/searchText/role/createdAt rather than applying them', () => {
      const parsed = productInputSchema.parse({
        ...valid,
        id: 'attacker-chosen-id',
        searchText: 'buy now cheap everywhere',
        role: 'admin',
        createdAt: '1999-01-01',
      });
      expect(parsed).not.toHaveProperty('id');
      expect(parsed).not.toHaveProperty('searchText');
      expect(parsed).not.toHaveProperty('role');
      expect(parsed).not.toHaveProperty('createdAt');
    });
  });

  describe('optional text', () => {
    it('collapses an empty brand to null', () => {
      const parsed = productInputSchema.parse({ ...valid, brand: '   ' });
      expect(parsed.brand).toBe(null);
    });
  });

  it('rejects an unknown pet type', () => {
    expect(
      productInputSchema.safeParse({ ...valid, petType: 'hamster' }).success,
    ).toBe(false);
  });
});
