import { describe, expect, it } from 'vitest';
import {
  DISCOUNT_TYPES,
  computeDiscount,
  discountCodeInputSchema,
  normalizeCode,
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
});
