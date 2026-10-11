import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  formatJalaliDateTime,
  formatJalaliMonth,
  formatJalaliYear,
  formatNumber,
  formatPercent,
  formatToman,
  jalaliMonthStart,
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

describe('formatPercent', () => {
  it('renders a ratio as a Persian percent', () => {
    expect(formatPercent(0.5)).toBe('۵۰٪');
    expect(formatPercent(1)).toBe('۱۰۰٪');
  });

  it('keeps one decimal at most, with the Persian decimal separator', () => {
    expect(formatPercent(0.025)).toBe('۲٫۵٪');
    expect(formatPercent(0.12345)).toBe('۱۲٫۳٪');
  });

  it('renders zero, and a negative zero, as ۰٪', () => {
    expect(formatPercent(0)).toBe('۰٪');
    expect(formatPercent(-0)).toBe('۰٪');
  });

  it('allows more than a hundred percent (orders can outnumber views)', () => {
    expect(formatPercent(1.5)).toBe('۱۵۰٪');
  });

  it('throws on a ratio that is not finite', () => {
    expect(() => formatPercent(Number.NaN)).toThrow(RangeError);
    expect(() => formatPercent(Infinity)).toThrow(RangeError);
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

// What the shop shows is the Tehran wall clock: Iran's own time, UTC+03:30
// all year, whatever zone the server runs in (the suite runs as UTC, like the
// container). A receipt a shopper sent at 14:05 in Tehran reads 14:05 to the
// shopper and to the admin.
describe('formatJalaliDateTime', () => {
  it('formats a UTC instant as its Tehran date and 24-hour time', () => {
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 9, 1, 10, 35)))).toBe(
      '۹ مهر ۱۴۰۵ ساعت ۱۴:۰۵',
    );
  });

  it('turns the day at Tehran midnight, not at UTC midnight', () => {
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 8, 30, 20, 29)))).toBe(
      '۸ مهر ۱۴۰۵ ساعت ۲۳:۵۹',
    );
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 8, 30, 20, 30)))).toBe(
      '۹ مهر ۱۴۰۵ ساعت ۰۰:۰۰',
    );
  });

  it('stays UTC+03:30 in summer — Iran has kept no daylight saving since 2022', () => {
    // 10:35 UTC on 21 June: 14:05 in Tehran, not the 15:05 of the old DST.
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 5, 21, 10, 35)))).toBe(
      '۳۱ خرداد ۱۴۰۵ ساعت ۱۴:۰۵',
    );
  });

  it('tells apart two receipts sent the same day', () => {
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 9, 1, 5, 0)))).toBe(
      '۹ مهر ۱۴۰۵ ساعت ۰۸:۳۰',
    );
    expect(formatJalaliDateTime(new Date(Date.UTC(2026, 9, 1, 15, 0)))).toBe(
      '۹ مهر ۱۴۰۵ ساعت ۱۸:۳۰',
    );
  });

  it('renders Persian digits only', () => {
    expect(
      formatJalaliDateTime(new Date(Date.UTC(2026, 9, 1, 10, 35))),
    ).not.toMatch(/[0-9]/);
  });

  it('throws on an invalid date rather than rendering garbage', () => {
    expect(() => formatJalaliDateTime(new Date('not a date'))).toThrow(
      RangeError,
    );
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

describe('jalaliMonthStart', () => {
  // 1 Mehr 1405 begins at 00:00 Tehran, which is 20:30 UTC on 22 Sep 2026.
  const MEHR_1405 = new Date('2026-09-22T20:30:00Z');

  it('is 00:00 Tehran on the Jalali 1st of the month `now` falls in', () => {
    expect(jalaliMonthStart(new Date('2026-09-29T12:00:00.123Z'))).toEqual(
      MEHR_1405,
    );
  });

  it('counts an instant still on the previous day in UTC as this month', () => {
    // 20:45 UTC on 22 Sep is 00:15 on 1 Mehr in Tehran.
    expect(jalaliMonthStart(new Date('2026-09-22T20:45:00Z'))).toEqual(
      MEHR_1405,
    );
    expect(jalaliMonthStart(MEHR_1405)).toEqual(MEHR_1405);
  });

  it('puts a minute before the Tehran midnight in the previous month', () => {
    // 20:29 UTC is 23:59 on 31 Shahrivar; Shahrivar began on 22 Aug 20:30 UTC.
    expect(jalaliMonthStart(new Date('2026-09-22T20:29:00Z'))).toEqual(
      new Date('2026-08-22T20:30:00Z'),
    );
  });

  it('rolls over at Nowruz', () => {
    expect(jalaliMonthStart(new Date('2026-03-20T20:30:00Z'))).toEqual(
      new Date('2026-03-20T20:30:00Z'),
    );
    // Esfand 1404 began on 19 Feb 2026 20:30 UTC.
    expect(jalaliMonthStart(new Date('2026-03-20T20:29:59.999Z'))).toEqual(
      new Date('2026-02-19T20:30:00Z'),
    );
  });

  it('throws on an invalid date rather than returning NaN', () => {
    expect(() => jalaliMonthStart(new Date('not a date'))).toThrow(RangeError);
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
