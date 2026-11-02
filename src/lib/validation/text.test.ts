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
const RLO = String.fromCharCode(0x202e);
const MARK = String.fromCharCode(0x200f);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const LF = String.fromCharCode(10);

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

  // This is the gate the class exists for, and it was missing here: the field
  // behind checkout and the address book only ever checked for NUL, so a
  // shopper could post a recipient name that reorders the admin's order screen.
  it.each([
    ['a right-to-left override', RLO],
    ['a bidi mark', MARK],
    ['a line separator', LINE_SEPARATOR],
    ['a paragraph separator', PARAGRAPH_SEPARATOR],
  ])('rejects %s', (_label, char) => {
    // Interior, not trailing: `trim()` runs first and treats U+2028/U+2029 as
    // whitespace, so a trailing one is stripped before the refine ever sees it.
    // Between a word and a number is where the reordering does its damage.
    expect(schema.safeParse(`علی${char}۱۲۳`).success).toBe(false);
  });

  it('still accepts a multi-line value — an address is a textarea', () => {
    // Under the cap on purpose: this probes the newline, not the length.
    const twoLines = `خیابان${LF}۱۰`;
    expect(schema.parse(twoLines)).toBe(twoLines);
  });

  it('still keeps a ZWNJ inside a Persian word', () => {
    const joined = `بی${String.fromCharCode(0x200c)}بو`;
    expect(schema.parse(joined)).toBe(joined);
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

  it('rejects a bidi override — a content field renders to every visitor', () => {
    expect(schema.safeParse(`ملت${RLO}`).success).toBe(false);
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

  it('rejects a bidi override', () => {
    expect(schema.safeParse(`نژاد${RLO}`).success).toBe(false);
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
  // U+2028 and U+2029 are Zl/Zp, so `\p{Cc}` never covered them. A paragraph
  // separator starts a new bidi paragraph and resets the base direction of
  // everything after it — the same damage, by a different mechanism.
  it.each([
    ['a line separator (U+2028)', LINE_SEPARATOR],
    ['a paragraph separator (U+2029)', PARAGRAPH_SEPARATOR],
  ])('flags %s', (_label, separator) => {
    expect(FORBIDDEN_TEXT_CHARS.test(`a${separator}b`)).toBe(true);
  });

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
