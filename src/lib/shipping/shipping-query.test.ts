import { describe, expect, it } from 'vitest';
import {
  provinceIdParamSchema,
  shippingFeeSchema,
} from '@/lib/shipping/shipping-query';

// Built with String.fromCharCode so no literal control byte sits in this source.
const NUL = String.fromCharCode(0);

describe('provinceIdParamSchema — the ?province= query value', () => {
  it('coerces a numeric string to the province id', () => {
    expect(provinceIdParamSchema.parse('7')).toBe(7);
    expect(provinceIdParamSchema.parse('1')).toBe(1);
  });

  it.each([
    ['zero (ids start at 1)', '0'],
    ['a negative id', '-1'],
    ['a fractional id', '1.5'],
    ['a non-numeric value', 'abc'],
    ['an empty value', ''],
    // Beyond the safe-integer range the id stops being exact; zod 4 caps .int()
    // there, which also keeps ?province=1e30 from reaching Postgres.
    ['an id past the safe-integer range', '1e30'],
  ])('rejects %s', (_label, value) => {
    expect(provinceIdParamSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a null byte rather than letting it reach Postgres as text', () => {
    // A numeric id can never legitimately carry U+0000; coercion turns it into
    // NaN/0, both of which fail — so the driver never throws a 500 on it.
    expect(provinceIdParamSchema.safeParse(`7${NUL}`).success).toBe(false);
    expect(provinceIdParamSchema.safeParse(NUL).success).toBe(false);
  });
});

describe('shippingFeeSchema — the admin rate-update fee', () => {
  it('accepts a whole-Toman fee and a free (zero) fee', () => {
    expect(shippingFeeSchema.parse(25_000)).toBe(25_000);
    // Free shipping is a real rate, matched to the fee >= 0 CHECK.
    expect(shippingFeeSchema.parse(0)).toBe(0);
  });

  it.each([
    ['a negative fee', -1],
    ['a fractional fee', 1500.5],
  ])('rejects %s', (_label, value) => {
    expect(shippingFeeSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a fee sent as a string — the JSON body must carry a number', () => {
    expect(shippingFeeSchema.safeParse('25000').success).toBe(false);
  });
});
