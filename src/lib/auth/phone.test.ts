import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PHONE_EXAMPLE,
  isCanonicalIranPhone,
  MAX_PHONE_INPUT_LENGTH,
  normalizeIranPhone,
  tempEmailForPhone,
  toLocalIranPhone,
} from './phone';

// The one number used throughout, in every shape a shopper's keyboard, a
// contact card or a paste from another site can produce it.
const CANONICAL = '+989121234567';

describe('normalizeIranPhone', () => {
  describe('accepted shapes all collapse to one canonical form', () => {
    it.each([
      ['already canonical', '+989121234567'],
      ['national with leading zero', '09121234567'],
      ['national without leading zero', '9121234567'],
      ['country code, no plus', '989121234567'],
      ['international access prefix', '00989121234567'],
      ['spaces, as the design placeholder shows it', '0912 123 4567'],
      ['dashes, as a contact card exports it', '0912-123-4567'],
      ['parentheses and mixed separators', '(0912) 123-45 67'],
      ['plus with spaces', '+98 912 123 4567'],
    ])('%s', (_label, input) => {
      expect(normalizeIranPhone(input)).toBe(CANONICAL);
    });

    it('folds Persian digits — what an Iranian keyboard actually types', () => {
      expect(normalizeIranPhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe(CANONICAL);
    });

    it('folds Arabic-Indic digits', () => {
      expect(normalizeIranPhone('٠٩١٢١٢٣٤٥٦٧')).toBe(CANONICAL);
    });

    it('folds a mix of Persian, Arabic-Indic and ASCII digits', () => {
      // Copy-pasting half a number and typing the rest produces exactly this.
      expect(normalizeIranPhone('۰۹١٢1234567')).toBe(CANONICAL);
    });

    it('folds Persian digits behind a country code', () => {
      expect(normalizeIranPhone('+۹۸۹۱۲۱۲۳۴۵۶۷')).toBe(CANONICAL);
    });

    it('is idempotent — re-normalizing canonical input is a no-op', () => {
      expect(normalizeIranPhone(CANONICAL)).toBe(CANONICAL);
      expect(normalizeIranPhone(normalizeIranPhone(CANONICAL)!)).toBe(
        CANONICAL,
      );
    });

    it('accepts every mobile operator prefix 090–099', () => {
      for (let prefix = 0; prefix <= 9; prefix++) {
        expect(normalizeIranPhone(`09${prefix}12345678`)).toBe(
          `+989${prefix}12345678`,
        );
      }
    });
  });

  describe('rejected input returns null rather than a guess', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['landline (Tehran)', '02112345678'],
      ['landline without zero', '2112345678'],
      ['one digit short', '0912123456'],
      ['one digit long', '091212345678'],
      ['national but not a mobile prefix', '08121234567'],
      ['letters', 'not-a-phone'],
      ['letters glued to a valid number', '09121234567abc'],
      ['a number with a decimal point', '0912.123.4567'],
      ['another country', '+14155552671'],
      ['plus in the middle', '0912+1234567'],
      ['double country code', '+98989121234567'],
      ['only the country code', '+98'],
      ['zeroes', '00000000000'],
    ])('%s', (_label, input) => {
      expect(normalizeIranPhone(input)).toBeNull();
    });

    it('rejects a number carrying an embedded NUL byte', () => {
      // Constructed, never typed (AGENTS.md): a literal U+0000 in source is
      // invisible to review and to every diff tool.
      const nul = String.fromCharCode(0);
      expect(normalizeIranPhone(`0912123${nul}4567`)).toBeNull();
    });

    it('rejects digits separated by a zero-width non-joiner', () => {
      // Persian text drags ZWNJ along; it must not silently glue a number
      // together, or two different strings would reach the same account.
      const zwnj = String.fromCharCode(0x200c);
      expect(normalizeIranPhone(`0912${zwnj}1234567`)).toBeNull();
    });

    it('rejects an RTL override wrapped around the number', () => {
      const rtlOverride = String.fromCharCode(0x202e);
      const popDirectional = String.fromCharCode(0x202c);
      expect(
        normalizeIranPhone(`${rtlOverride}09121234567${popDirectional}`),
      ).toBeNull();
    });

    it('rejects a non-breaking space between groups', () => {
      const nbsp = String.fromCharCode(0xa0);
      expect(normalizeIranPhone(`0912${nbsp}1234567`)).toBeNull();
    });

    it('rejects a very long string without walking off into a slow path', () => {
      expect(normalizeIranPhone('9'.repeat(10_000))).toBeNull();
    });

    describe('the length cap is a rule, not just a shortcut', () => {
      // 10 000 digits above are rejected on shape too, so that case passes with
      // or without the cap. Separators are what tell the two apart: padding a
      // real number past the cap leaves something that *would* normalize.
      const padded = (pad: number) =>
        `${'('.repeat(pad)}09121234567${')'.repeat(pad)}`;

      it('accepts a padded number that still fits', () => {
        const input = padded(10);
        expect(input).toHaveLength(MAX_PHONE_INPUT_LENGTH - 1);
        expect(normalizeIranPhone(input)).toBe(CANONICAL);
      });

      it('rejects the same number once the padding passes the cap', () => {
        const input = padded(13);
        expect(input.length).toBeGreaterThan(MAX_PHONE_INPUT_LENGTH);
        expect(normalizeIranPhone(input)).toBeNull();
      });
    });
  });

  it('exposes the canonical example the UI hint shows', () => {
    expect(normalizeIranPhone(CANONICAL_PHONE_EXAMPLE)).not.toBeNull();
  });
});

describe('isCanonicalIranPhone', () => {
  it('accepts the canonical form', () => {
    expect(isCanonicalIranPhone(CANONICAL)).toBe(true);
  });

  it.each([
    ['national with leading zero', '09121234567'],
    ['national without leading zero', '9121234567'],
    ['country code without the plus', '989121234567'],
    ['international access prefix', '00989121234567'],
    ['canonical digits with a space', '+98 912 123 4567'],
    ['Persian digits', '۰۹۱۲۱۲۳۴۵۶۷'],
  ])('rejects a valid number written as %s', (_label, input) => {
    // Every one of these normalizes to a real number — and every one of them
    // would become a *second* account if the API accepted it verbatim.
    expect(normalizeIranPhone(input)).not.toBeNull();
    expect(isCanonicalIranPhone(input)).toBe(false);
  });

  it('rejects a number that is not Iranian at all', () => {
    expect(isCanonicalIranPhone('+14155552671')).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    expect(isCanonicalIranPhone(undefined)).toBe(false);
    expect(isCanonicalIranPhone(null)).toBe(false);
    expect(isCanonicalIranPhone(989121234567)).toBe(false);
    expect(isCanonicalIranPhone({ phoneNumber: CANONICAL })).toBe(false);
    expect(isCanonicalIranPhone([CANONICAL])).toBe(false);
  });
});

describe('toLocalIranPhone', () => {
  it('renders canonical storage as the 09… form a shopper recognises', () => {
    expect(toLocalIranPhone(CANONICAL)).toBe('09121234567');
  });

  it('leaves anything non-canonical alone rather than inventing a shape', () => {
    expect(toLocalIranPhone('09121234567')).toBe('09121234567');
    expect(toLocalIranPhone('')).toBe('');
  });
});

describe('tempEmailForPhone', () => {
  it('derives the address a phone-only account is filed under', () => {
    expect(tempEmailForPhone(CANONICAL)).toBe(
      '989121234567@phone.smokey.invalid',
    );
  });

  it('uses a TLD that can never resolve', () => {
    // RFC 2606 reserves `.invalid`. A real-looking domain here would make some
    // future mailer deliverable to an address nobody owns.
    expect(tempEmailForPhone(CANONICAL).endsWith('.invalid')).toBe(true);
  });

  it('gives different numbers different addresses', () => {
    // `email` is unique, so a collision would merge two people into one account.
    expect(tempEmailForPhone('+989121234567')).not.toBe(
      tempEmailForPhone('+989121234568'),
    );
  });
});
