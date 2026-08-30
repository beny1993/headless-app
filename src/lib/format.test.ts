import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  formatJalaliYear,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';

// fa-IR emits U+2212 MINUS SIGN preceded by U+200E LTR MARK — both invisible in
// an editor, so every negative expectation is written with explicit escapes.
const MINUS = '‎−';
// fa-IR groups with U+066C ARABIC THOUSANDS SEPARATOR, not a Latin comma.
const SEP = '٬';

describe('toPersianDigits', () => {
  it('converts every Latin digit', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
  });

  it('leaves non-digit characters untouched', () => {
    expect(toPersianDigits('کد ۲: A-42/7')).toBe('کد ۲: A-۴۲/۷');
  });

  it('accepts numbers and bigints', () => {
    expect(toPersianDigits(10045)).toBe('۱۰۰۴۵');
    expect(toPersianDigits(10045n)).toBe('۱۰۰۴۵');
  });

  it('does not group — order numbers and OTP codes must stay ungrouped', () => {
    expect(toPersianDigits(123456)).toBe('۱۲۳۴۵۶');
  });

  it('returns an empty string unchanged', () => {
    expect(toPersianDigits('')).toBe('');
  });

  it('keeps already-Persian digits as they are', () => {
    expect(toPersianDigits('۱۲۳')).toBe('۱۲۳');
  });

  it('preserves a leading zero', () => {
    expect(toPersianDigits('09121234567')).toBe('۰۹۱۲۱۲۳۴۵۶۷');
  });
});

describe('formatNumber', () => {
  it('groups thousands with the fa-IR separator', () => {
    expect(formatNumber(2450000)).toBe(`۲${SEP}۴۵۰${SEP}۰۰۰`);
  });

  it('leaves values under a thousand ungrouped', () => {
    expect(formatNumber(999)).toBe('۹۹۹');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('۰');
  });

  it('formats bigints beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(formatNumber(12345678901234567890n)).toBe(
      `۱۲${SEP}۳۴۵${SEP}۶۷۸${SEP}۹۰۱${SEP}۲۳۴${SEP}۵۶۷${SEP}۸۹۰`,
    );
  });

  it('formats negatives with the Persian minus', () => {
    expect(formatNumber(-1500)).toBe(`${MINUS}۱${SEP}۵۰۰`);
  });

  it('renders a computed negative zero as plain zero', () => {
    expect(formatNumber(-0)).toBe('۰');
  });

  it('rejects NaN and Infinity', () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatToman', () => {
  it('formats a price with Persian digits, separators and the unit', () => {
    expect(formatToman(2450000)).toBe(`۲${SEP}۴۵۰${SEP}۰۰۰ تومان`);
  });

  it('accepts bigint — the storage type for money', () => {
    expect(formatToman(2450000n)).toBe(`۲${SEP}۴۵۰${SEP}۰۰۰ تومان`);
  });

  it('formats zero rather than hiding it', () => {
    expect(formatToman(0)).toBe('۰ تومان');
    expect(formatToman(0n)).toBe('۰ تومان');
  });

  it('formats an exact thousand', () => {
    expect(formatToman(1000)).toBe(`۱${SEP}۰۰۰ تومان`);
  });

  it('formats amounts beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    // 9007199254740993 is unrepresentable as a double; bigint keeps the 3.
    expect(formatToman(9007199254740993n)).toBe(
      `۹${SEP}۰۰۷${SEP}۱۹۹${SEP}۲۵۴${SEP}۷۴۰${SEP}۹۹۳ تومان`,
    );
  });

  it('formats negatives — refunds and adjustments are displayed, not rejected', () => {
    expect(formatToman(-50000)).toBe(`${MINUS}۵۰${SEP}۰۰۰ تومان`);
    expect(formatToman(-50000n)).toBe(`${MINUS}۵۰${SEP}۰۰۰ تومان`);
  });

  it('never renders a negative zero — a zero discount is not «‎−۰»', () => {
    expect(formatToman(-0)).toBe('۰ تومان');
  });

  it('rejects a non-integer number — Toman is integer-only', () => {
    expect(() => formatToman(1500.5)).toThrow(RangeError);
  });

  it('rejects an unsafe integer number — pass a bigint at that magnitude', () => {
    // Written as an expression, not a literal: the literal form is itself a
    // precision bug and eslint rejects it.
    expect(() => formatToman(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => formatToman(Number.NaN)).toThrow(RangeError);
    expect(() => formatToman(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('never emits a Latin digit or a Latin comma', () => {
    expect(formatToman(1234567)).not.toMatch(/[0-9,]/);
  });
});

describe('formatJalali', () => {
  it('formats a known UTC instant as its Jalali date', () => {
    expect(formatJalali(new Date(Date.UTC(2026, 7, 29, 12, 0, 0)))).toBe(
      '۷ شهریور ۱۴۰۵',
    );
  });

  it('formats the Unix epoch', () => {
    expect(formatJalali(new Date(0))).toBe('۱۱ دی ۱۳۴۸');
  });

  // Tehran is UTC+03:30 (no DST since 2022), so these two instants — 30 minutes
  // apart — fall on opposite sides of Nowruz. This fails if the formatter reads
  // the host timezone instead of pinning Asia/Tehran.
  it('resolves the day in Tehran time, not the host timezone', () => {
    expect(formatJalali(new Date(Date.UTC(2026, 2, 20, 20, 0, 0)))).toBe(
      '۲۹ اسفند ۱۴۰۴',
    );
    expect(formatJalali(new Date(Date.UTC(2026, 2, 20, 20, 30, 0)))).toBe(
      '۱ فروردین ۱۴۰۵',
    );
  });

  it('renders Persian digits only', () => {
    expect(formatJalali(new Date(Date.UTC(2026, 7, 29)))).not.toMatch(/[0-9]/);
  });

  it('throws on an invalid date rather than rendering garbage', () => {
    expect(() => formatJalali(new Date('not a date'))).toThrow(RangeError);
  });
});

describe('formatJalaliYear', () => {
  it('returns the Jalali year alone', () => {
    expect(formatJalaliYear(new Date(Date.UTC(2026, 7, 29, 12, 0, 0)))).toBe(
      '۱۴۰۵',
    );
  });

  it('rolls over at Nowruz in Tehran time', () => {
    expect(formatJalaliYear(new Date(Date.UTC(2026, 2, 20, 20, 0, 0)))).toBe(
      '۱۴۰۴',
    );
    expect(formatJalaliYear(new Date(Date.UTC(2026, 2, 20, 20, 30, 0)))).toBe(
      '۱۴۰۵',
    );
  });

  it('defaults to now — the footer copyright has no date to pass', () => {
    expect(formatJalaliYear()).toMatch(/^[۰-۹]{4}$/);
  });
});
