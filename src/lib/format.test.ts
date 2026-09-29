import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  formatJalaliMonth,
  formatJalaliYear,
  formatNumber,
  formatToman,
  jalaliYearMonth,
  parseDigits,
  toPersianDigits,
} from '@/lib/format';

// fa-IR emits U+2212 MINUS SIGN preceded by U+200E LTR MARK — both invisible in
// an editor, so the mark is constructed with `String.fromCharCode`, never typed,
// per the project's control-character rule.
const MINUS = String.fromCharCode(0x200e) + '−';
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

  it(`never renders a negative zero — a zero discount is not «${MINUS}۰»`, () => {
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

describe('jalaliYearMonth', () => {
  it('returns integer Jalali year and month in Tehran time', () => {
    // 29 Aug 2026 → 7 Shahrivar 1405 (month 6).
    expect(jalaliYearMonth(new Date(Date.UTC(2026, 7, 29, 12, 0, 0)))).toEqual({
      year: 1405,
      month: 6,
    });
  });

  it('rolls the month and year over at Nowruz in Tehran time', () => {
    // 20 Mar 2026 23:30 Tehran — still Esfand 1404 (month 12).
    expect(jalaliYearMonth(new Date(Date.UTC(2026, 2, 20, 20, 0, 0)))).toEqual({
      year: 1404,
      month: 12,
    });
    // 21 Mar 2026 00:00 Tehran — Farvardin 1405 (month 1).
    expect(jalaliYearMonth(new Date(Date.UTC(2026, 2, 20, 20, 30, 0)))).toEqual(
      { year: 1405, month: 1 },
    );
  });

  it('throws on an invalid date rather than returning NaN', () => {
    expect(() => jalaliYearMonth(new Date('not a date'))).toThrow(RangeError);
  });
});

describe('formatJalaliMonth', () => {
  it('returns the Jalali month name alone', () => {
    expect(formatJalaliMonth(new Date(Date.UTC(2026, 7, 29, 12, 0, 0)))).toBe(
      'شهریور',
    );
  });

  it('respects the Nowruz boundary in Tehran time', () => {
    expect(formatJalaliMonth(new Date(Date.UTC(2026, 2, 20, 20, 30, 0)))).toBe(
      'فروردین',
    );
  });

  it('carries no digits — it is a label, not a date', () => {
    expect(formatJalaliMonth(new Date(Date.UTC(2026, 7, 29)))).not.toMatch(
      /[0-9۰-۹]/,
    );
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

describe('parseDigits', () => {
  it('reads ASCII, Persian and Arabic-Indic digits', () => {
    expect(parseDigits('1250')).toBe(1250);
    expect(parseDigits('۱۲۵۰')).toBe(1250);
    expect(parseDigits('١٢٥٠')).toBe(1250);
    expect(parseDigits('۰')).toBe(0);
  });

  it('is undefined for empty or blank input', () => {
    expect(parseDigits('')).toBeUndefined();
    expect(parseDigits('   ')).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(parseDigits('  ۴۲ ')).toBe(42);
  });

  it('drops Latin and Persian thousands separators', () => {
    expect(parseDigits('1,250,000')).toBe(1_250_000);
    expect(parseDigits('125,000')).toBe(125_000);
    expect(parseDigits(`۱${SEP}۲۵۰${SEP}۰۰۰`)).toBe(1_250_000);
  });

  it('keeps a sign, so the schema can refuse it in its own words', () => {
    expect(parseDigits('-5')).toBe(-5);
    expect(parseDigits('-1,000')).toBe(-1000);
  });

  // A separator only counts where it groups thousands. Anywhere else the text is
  // a typo or a decimal comma — read as another number, `7,5` in the discount
  // form would create a 75% code.
  it('is NaN for a separator that does not group thousands', () => {
    for (const raw of [
      '7,5',
      '50,00',
      '1,200,00',
      '1,2345',
      '12,',
      ',12',
      '1,,200',
      '0,500',
      `۷${SEP}۵`,
    ]) {
      expect(parseDigits(raw)).toBeNaN();
    }
  });

  // Every field it feeds is whole Toman or a count, and `25.000` is ambiguous —
  // 25, or 25,000 grouped with a dot — so a fraction is refused, never guessed.
  it('is NaN for a fraction', () => {
    for (const raw of ['25.000', '۲۵.۰۰۰', '1.5', '۱.۵', '1,200.5']) {
      expect(parseDigits(raw)).toBeNaN();
    }
  });

  it('is NaN for anything that is not a plain whole number', () => {
    for (const raw of [
      'abc',
      '12abc',
      '1e3',
      '0x10',
      'Infinity',
      '1 000',
      '.',
      '-',
    ]) {
      expect(parseDigits(raw)).toBeNaN();
    }
  });
});
