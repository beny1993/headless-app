// Pure schema behaviour — no database. The null byte is CONSTRUCTED with
// `String.fromCharCode(0)`, never typed, per the project's control-character rule.
import { describe, expect, it } from 'vitest';
import { boundedText, optionalBoundedText } from '@/lib/validation/text';

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
