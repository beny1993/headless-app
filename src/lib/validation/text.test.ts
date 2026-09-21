// Pure schema behaviour — no database. The null byte is CONSTRUCTED with
// `String.fromCharCode(0)`, never typed, per the project's control-character rule.
import { describe, expect, it } from 'vitest';
import {
  boundedText,
  FORBIDDEN_TEXT_CHARS,
  blankableText,
  optionalBoundedText,
  VISIBLE_CHAR,
} from '@/lib/validation/text';

const NUL = String.fromCharCode(0);

describe('boundedText', () => {
  const schema = boundedText(10);

  it('accepts a trimmed Persian value and strips surrounding whitespace', () => {
    expect(schema.parse('  علی  ')).toBe('علی');
  });

  it('rejects an empty or whitespace-only value', () => {
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse('   ').success).toBe(false);
  });

  it('rejects a value over the cap (measured after trim)', () => {
    expect(schema.safeParse('12345678901').success).toBe(false);
    // Trailing space does not push a boundary value over — trim runs first.
    expect(schema.parse('1234567890 ')).toBe('1234567890');
  });

  it('rejects a null byte (would 500 in the pg driver)', () => {
    expect(schema.safeParse(`a${NUL}b`).success).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(schema.safeParse(42).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
});

describe('blankableText', () => {
  const schema = blankableText(10);

  it('keeps an empty or whitespace-only value as the empty string', () => {
    expect(schema.parse('')).toBe('');
    expect(schema.parse('   ')).toBe('');
  });

  it('trims and keeps a present value', () => {
    expect(schema.parse('  ملت ')).toBe('ملت');
  });

  it('rejects a value over the cap and a null byte', () => {
    expect(schema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(schema.safeParse(`a${String.fromCharCode(0)}b`).success).toBe(false);
  });
});

describe('optionalBoundedText', () => {
  const schema = optionalBoundedText(10);

  it('accepts an absent value as undefined', () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it('collapses an empty or whitespace-only value to undefined', () => {
    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('   ')).toBeUndefined();
  });

  it('trims and keeps a present value', () => {
    expect(schema.parse('  ایرانی ')).toBe('ایرانی');
  });

  it('rejects a value over the cap', () => {
    expect(schema.safeParse('12345678901').success).toBe(false);
  });

  it('rejects a null byte', () => {
    expect(schema.safeParse(`a${NUL}b`).success).toBe(false);
  });
});

describe('FORBIDDEN_TEXT_CHARS', () => {
  // The invisibles are CONSTRUCTED, never typed — a literal byte here would be
  // invisible to review and to every diff (the repo's control-character rule).
  const LRM = String.fromCharCode(0x200e);
  const RLM = String.fromCharCode(0x200f);
  const ALM = String.fromCharCode(0x061c);
  const ZWNJ = String.fromCharCode(0x200c);

  it('flags control characters and bidi overrides/isolates, but not ZWNJ', () => {
    expect(FORBIDDEN_TEXT_CHARS.test(`a${NUL}b`)).toBe(true);
    expect(FORBIDDEN_TEXT_CHARS.test('a\u202Eb')).toBe(true);
    expect(FORBIDDEN_TEXT_CHARS.test('a\u2066b')).toBe(true);
    expect(FORBIDDEN_TEXT_CHARS.test('اسباب\u200Cبازی')).toBe(false);
  });

  // The embeddings, overrides and isolates were covered; the *marks* were not,
  // and they reorder the neutral characters beside them the same way — a price,
  // a phone number or a bracket next to one renders somewhere it was not typed.
  it.each([
    ['a left-to-right mark (U+200E)', LRM],
    ['a right-to-left mark (U+200F)', RLM],
    ['an Arabic letter mark (U+061C)', ALM],
  ])('flags %s', (_, mark) => {
    expect(FORBIDDEN_TEXT_CHARS.test(`123 ${mark}456`)).toBe(true);
    expect(FORBIDDEN_TEXT_CHARS.test(mark)).toBe(true);
  });

  it('still allows ZWNJ, the Persian joiner one code point from U+200E', () => {
    // Widening the class must not take U+200C along, or every Persian title
    // spelled with a joiner becomes invalid.
    expect(FORBIDDEN_TEXT_CHARS.test(ZWNJ)).toBe(false);
    expect(FORBIDDEN_TEXT_CHARS.test(`a${ZWNJ}b`)).toBe(false);
  });
});

describe('VISIBLE_CHAR', () => {
  it('needs at least one letter, digit, punctuation mark or symbol', () => {
    expect(VISIBLE_CHAR.test('\u200C\u200C')).toBe(false);
    expect(VISIBLE_CHAR.test('قم')).toBe(true);
  });
});
