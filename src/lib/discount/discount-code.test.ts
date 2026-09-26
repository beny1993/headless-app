import { describe, expect, it } from 'vitest';
import type { DiscountCode } from '@/db/schema/discounts';
import {
  DISCOUNT_TYPES,
  computeDiscount,
  discountCodeInputSchema,
  normalizeCode,
  toDiscountView,
} from './discount-code';

describe('normalizeCode', () => {
  it('trims and uppercases so lookups are case- and space-insensitive at the ends', () => {
    expect(normalizeCode('  welcome10 ')).toBe('WELCOME10');
    expect(normalizeCode('Nowruz-1405')).toBe('NOWRUZ-1405');
  });
});

describe('computeDiscount', () => {
  const percent = (value: number) => ({ type: DISCOUNT_TYPES.PERCENT, value });
  const fixed = (value: number) => ({ type: DISCOUNT_TYPES.FIXED, value });

  it('computes a percentage of the subtotal', () => {
    expect(computeDiscount(percent(10), 200_000)).toBe(20_000);
  });

  it('floors a non-divisible percentage so the shop never over-discounts', () => {
    // 15% of 33,333 = 4,999.95 → 4,999, not 5,000.
    expect(computeDiscount(percent(15), 33_333)).toBe(4_999);
  });

  it('returns the fixed amount unchanged when it is below the subtotal', () => {
    expect(computeDiscount(fixed(50_000), 200_000)).toBe(50_000);
  });

  it('clamps a fixed amount larger than the subtotal to the subtotal (never negative total)', () => {
    expect(computeDiscount(fixed(500_000), 200_000)).toBe(200_000);
  });

  it('clamps a 100% code to the subtotal', () => {
    expect(computeDiscount(percent(100), 200_000)).toBe(200_000);
  });

  it('is zero when the subtotal is zero', () => {
    expect(computeDiscount(percent(50), 0)).toBe(0);
    expect(computeDiscount(fixed(50_000), 0)).toBe(0);
  });

  it('keeps integer precision when the percentage multiplication exceeds the safe range', () => {
    expect(computeDiscount(percent(33), 9_007_199_254_740_000)).toBe(
      2_972_375_754_064_200,
    );
    // Hand-computed MAX_SAFE_INTEGER boundary. The old floating-point
    // multiplication produced 2_972_375_754_064_526, one Toman short.
    expect(computeDiscount(percent(33), Number.MAX_SAFE_INTEGER)).toBe(
      2_972_375_754_064_527,
    );
  });
});

describe('discountCodeInputSchema (admin create body)', () => {
  const base = {
    code: 'welcome10',
    expiresAt: null,
    usageLimit: null,
    minOrderAmount: 0,
    isActive: true,
  };

  it('accepts a valid percent code and normalizes the code to uppercase', () => {
    const parsed = discountCodeInputSchema.parse({
      ...base,
      type: 'percent',
      value: 10,
    });
    expect(parsed.code).toBe('WELCOME10');
    if (parsed.type !== 'percent') throw new Error('expected percent');
    expect(parsed.value).toBe(10);
  });

  it('accepts a valid fixed code', () => {
    const parsed = discountCodeInputSchema.parse({
      ...base,
      code: 'OFF-50K',
      type: 'fixed',
      value: 50_000,
    });
    expect(parsed.value).toBe(50_000);
  });

  it('rejects a percent value below 1 or above 100', () => {
    expect(
      discountCodeInputSchema.safeParse({ ...base, type: 'percent', value: 0 })
        .success,
    ).toBe(false);
    expect(
      discountCodeInputSchema.safeParse({
        ...base,
        type: 'percent',
        value: 101,
      }).success,
    ).toBe(false);
  });

  it('rejects a fixed value of zero or below', () => {
    expect(
      discountCodeInputSchema.safeParse({ ...base, type: 'fixed', value: 0 })
        .success,
    ).toBe(false);
  });

  it('rejects a negative minimum order amount', () => {
    expect(
      discountCodeInputSchema.safeParse({
        ...base,
        type: 'percent',
        value: 10,
        minOrderAmount: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive usage limit', () => {
    expect(
      discountCodeInputSchema.safeParse({
        ...base,
        type: 'percent',
        value: 10,
        usageLimit: 0,
      }).success,
    ).toBe(false);
  });

  it('bounds usage limits to the database integer column', () => {
    const input = { ...base, type: 'percent', value: 10 };
    expect(
      discountCodeInputSchema.safeParse({ ...input, usageLimit: 2_147_483_647 })
        .success,
    ).toBe(true);
    expect(
      discountCodeInputSchema.safeParse({ ...input, usageLimit: 2_147_483_648 })
        .success,
    ).toBe(false);
  });

  it('strips server-owned fields (mass-assignment gate): usageCount and id never survive', () => {
    const parsed = discountCodeInputSchema.parse({
      ...base,
      type: 'percent',
      value: 10,
      usageCount: 999,
      id: 'attacker-supplied',
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('usageCount');
    expect(parsed).not.toHaveProperty('id');
  });

  it('rejects an unknown discount type', () => {
    expect(
      discountCodeInputSchema.safeParse({ ...base, type: 'bogus', value: 10 })
        .success,
    ).toBe(false);
  });

  it('rejects a code with whitespace or symbols in the middle', () => {
    expect(
      discountCodeInputSchema.safeParse({
        ...base,
        code: 'BAD CODE',
        type: 'percent',
        value: 10,
      }).success,
    ).toBe(false);
  });

  // The admin form hands a number field `parseDigits`' NaN (or `undefined`) for
  // text that is not a whole number, and shows the issue's message as-is — so a
  // field needs its Persian copy on the base type, not only on `.int()`.
  it.each([
    [
      'percent value',
      { type: 'percent', value: Number.NaN },
      { type: 'percent', value: 0 },
      'value',
    ],
    [
      'fixed value',
      { type: 'fixed', value: undefined },
      { type: 'fixed', value: 0 },
      'value',
    ],
    [
      'minimum order',
      { type: 'percent', value: 10, minOrderAmount: Number.NaN },
      { type: 'percent', value: 10, minOrderAmount: -1 },
      'minOrderAmount',
    ],
    [
      'usage limit',
      { type: 'percent', value: 10, usageLimit: Number.NaN },
      { type: 'percent', value: 10, usageLimit: 0 },
      'usageLimit',
    ],
  ])(
    'answers an unreadable %s with the field’s own Persian message',
    (_label, unreadable, outOfRange, path) => {
      const messageFor = (fields: object) =>
        discountCodeInputSchema
          .safeParse({ ...base, ...fields })
          .error?.issues.find((issue) => issue.path[0] === path)?.message;

      const persian = messageFor(outOfRange);
      expect(persian).toMatch(/[؀-ۿ]/);
      expect(messageFor(unreadable)).toBe(persian);
    },
  );
});

// The admin projection: what create and toggle return, and what the panel lists.
// `expiresAt` is the one branch — a code with no expiry must reach the client as
// `null`, not as the string "null" or a dropped key.
describe('toDiscountView', () => {
  const row = (expiresAt: Date | null): DiscountCode => ({
    id: '33333333-3333-4333-8333-333333333333',
    code: 'NOWRUZ1405',
    type: DISCOUNT_TYPES.PERCENT,
    value: 20,
    expiresAt,
    usageLimit: 100,
    usageCount: 7,
    minOrderAmount: 500_000,
    isActive: true,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  it('ISOs every date a code carries', () => {
    expect(toDiscountView(row(new Date('2026-04-20T20:30:00.000Z')))).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      code: 'NOWRUZ1405',
      type: DISCOUNT_TYPES.PERCENT,
      value: 20,
      expiresAt: '2026-04-20T20:30:00.000Z',
      usageLimit: 100,
      usageCount: 7,
      minOrderAmount: 500_000,
      isActive: true,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });
  });

  it('keeps a code that never expires as an explicit null', () => {
    expect(toDiscountView(row(null)).expiresAt).toBeNull();
  });
});
