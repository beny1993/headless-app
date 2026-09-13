import { describe, expect, it } from 'vitest';
import { PET_TYPES } from './product-query';
import {
  PRODUCT_MESSAGES,
  PRODUCT_TEXT_LIMITS,
  productInputSchema,
} from './product-input';

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

    it('gives the Persian message (not zod English) for a blank/NaN price or stock', () => {
      // A left-blank numeric field fails the BASE z.number() check (NaN/null), not
      // .int()/.positive() — so the message must be set on z.number() itself or
      // zod falls back to English "expected number, received NaN". Regression for
      // the QA-found copy leak. (Revert the `{ error }` on the base call → English.)
      const messageFor = (value: unknown, field: 'price' | 'stock') => {
        const res = productInputSchema.safeParse({ ...valid, [field]: value });
        if (res.success) throw new Error('expected a validation failure');
        return res.error.issues.find((i) => i.path[0] === field)?.message ?? '';
      };
      for (const bad of [null, NaN, undefined, 'x']) {
        expect(messageFor(bad, 'price')).toBe(
          'قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد (تومان).',
        );
        expect(messageFor(bad, 'stock')).toBe(
          'موجودی باید عددی صحیح و صفر یا بیشتر باشد.',
        );
      }
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

  describe('free-text hardening', () => {
    // Control and bidi characters are built from code points, never typed.
    const NUL = String.fromCharCode(0);
    const TAB = String.fromCharCode(9);
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const ZWNJ = String.fromCharCode(0x200c);
    const RLO = String.fromCharCode(0x202e);
    const LRI = String.fromCharCode(0x2066);

    const TEXT_FIELDS = [
      'title',
      'sku',
      'brand',
      'benefit',
      'description',
    ] as const;
    type TextField = (typeof TEXT_FIELDS)[number];

    const LENGTH_MESSAGE: Record<TextField, string> = {
      title: PRODUCT_MESSAGES.titleLength,
      sku: PRODUCT_MESSAGES.skuLength,
      brand: PRODUCT_MESSAGES.brandLength,
      benefit: PRODUCT_MESSAGES.benefitLength,
      description: PRODUCT_MESSAGES.descriptionLength,
    };

    /** The first message zod attached to `field`, or undefined when it passed. */
    const messageFor = (field: TextField, value: unknown) =>
      productInputSchema
        .safeParse({ ...valid, [field]: value })
        .error?.issues.find((issue) => issue.path[0] === field)?.message;

    const parsedField = (field: TextField, value: string) =>
      productInputSchema.parse({ ...valid, [field]: value })[field];

    it.each(TEXT_FIELDS)('accepts %s at its length cap', (field) => {
      const atCap = 'a'.repeat(PRODUCT_TEXT_LIMITS[field]);
      expect(parsedField(field, atCap)).toBe(atCap);
    });

    it.each(TEXT_FIELDS)(
      'rejects %s one past its cap with its Persian message',
      (field) => {
        const pastCap = 'a'.repeat(PRODUCT_TEXT_LIMITS[field] + 1);
        expect(messageFor(field, pastCap)).toBe(LENGTH_MESSAGE[field]);
      },
    );

    it('measures the cap after trimming', () => {
      const atCap = 'a'.repeat(PRODUCT_TEXT_LIMITS.title);
      expect(parsedField('title', `  ${atCap}  `)).toBe(atCap);
    });

    it.each(TEXT_FIELDS)(
      'rejects a NUL byte in %s — Postgres would refuse it as a 500',
      (field) => {
        expect(messageFor(field, `abc${NUL}def`)).toBe(
          PRODUCT_MESSAGES.textChars,
        );
      },
    );

    it.each(TEXT_FIELDS)('rejects a bidi override in %s', (field) => {
      expect(messageFor(field, `${RLO}abc`)).toBe(PRODUCT_MESSAGES.textChars);
    });

    it.each(TEXT_FIELDS)('rejects a directional isolate in %s', (field) => {
      expect(messageFor(field, `abc${LRI}def`)).toBe(
        PRODUCT_MESSAGES.textChars,
      );
    });

    it.each(['title', 'brand', 'benefit', 'description'] as const)(
      'keeps a ZWNJ inside a Persian word in %s',
      (field) => {
        expect(parsedField(field, 'غذای اسباب‌بازی')).toBe('غذای اسباب‌بازی');
      },
    );

    it('keeps newlines, carriage returns and tabs in the description', () => {
      const multiline = `خط اول${CR}${LF}خط دوم${LF}${TAB}خط سوم`;
      expect(parsedField('description', multiline)).toBe(multiline);
    });

    it.each(['title', 'sku', 'brand', 'benefit'] as const)(
      'rejects a newline in the single-line field %s',
      (field) => {
        expect(messageFor(field, `abc${LF}def`)).toBe(
          PRODUCT_MESSAGES.textChars,
        );
      },
    );

    it('rejects a title of only invisible characters as missing', () => {
      expect(messageFor('title', ZWNJ.repeat(5))).toBe(PRODUCT_MESSAGES.title);
    });

    it('rejects an SKU of only invisible characters as missing', () => {
      expect(messageFor('sku', ZWNJ.repeat(2))).toBe(PRODUCT_MESSAGES.sku);
    });

    it('gives the Persian title message, not zod English, for a missing title', () => {
      const { title, ...withoutTitle } = valid;
      void title;
      const issue = productInputSchema
        .safeParse(withoutTitle)
        .error?.issues.find((i) => i.path[0] === 'title');
      expect(issue?.message).toBe(PRODUCT_MESSAGES.title);
    });
  });
});
