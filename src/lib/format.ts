// Persian display formatting. Every number and date the storefront renders goes
// through this module — never a Persian literal in a component, or the site ends
// up with two thousands separators on the same screen (design review, finding 7).
//
// No date dependency anywhere: Jalali comes from `Intl` (`Smokey Shop Info`).

const LOCALE = 'fa-IR';

// Iran is UTC+03:30 year-round (DST abolished in 2022). Timestamps are stored
// UTC, so the calendar day has to be resolved in Tehran time — without this pin
// the same instant renders as a different Jalali day depending on where the
// server runs, and around Nowruz as a different *year*.
const TIME_ZONE = 'Asia/Tehran';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Latin digits → Persian, ungrouped, everything else untouched.
 *
 * For values that must not gain thousands separators: order numbers, OTP codes,
 * phone numbers, countdown timers. Grouped numbers use {@link formatNumber}.
 */
export function toPersianDigits(value: string | number | bigint): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Persian digits with fa-IR thousands separators (U+066C, not a Latin comma). */
export function formatNumber(value: number | bigint): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`formatNumber: not a finite number: ${value}`);
  }
  return value.toLocaleString(LOCALE);
}

/**
 * Money for display: `۲٬۴۵۰٬۰۰۰ تومان`.
 *
 * Toman is integer-only and stored as `bigint`, so a non-integer or unsafe
 * `number` reaching here is a bug upstream — it throws rather than rendering a
 * rounded price. Amounts above `Number.MAX_SAFE_INTEGER` must be passed as
 * `bigint`, which formats exactly.
 *
 * Negatives are formatted, not rejected: refunds and order adjustments display
 * as `‎−۵۰٬۰۰۰ تومان`.
 */
export function formatToman(amount: bigint | number): string {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new RangeError(
      `formatToman: Toman must be an integer within the safe range (use bigint beyond it), got: ${amount}`,
    );
  }
  return `${formatNumber(amount)} تومان`;
}

const jalaliDate = new Intl.DateTimeFormat(LOCALE, {
  calendar: 'persian',
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const jalaliYear = new Intl.DateTimeFormat(LOCALE, {
  calendar: 'persian',
  timeZone: TIME_ZONE,
  year: 'numeric',
});

/** A UTC instant as its Tehran-local Jalali date: `۷ شهریور ۱۴۰۵`. */
export function formatJalali(date: Date): string {
  return jalaliDate.format(date);
}

/** The Jalali year alone: `۱۴۰۵`. Defaults to now (footer copyright). */
export function formatJalaliYear(date: Date = new Date()): string {
  return jalaliYear.format(date);
}
