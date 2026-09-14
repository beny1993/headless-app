import { describe, expect, it } from 'vitest';
import {
  generateSku,
  MAX_SKU_LENGTH,
  MAX_SLUG_LENGTH,
  SKU_ALPHABET,
  SKU_SUFFIX_LENGTH,
  skuPreview,
} from './sku';

/** A fixed byte source, recording how many bytes each call asked for. */
const fixedBytes = (...values: number[]) => {
  const requested: number[] = [];
  const source = (length: number) => {
    requested.push(length);
    return Uint8Array.from(values.slice(0, length));
  };
  return { source, requested };
};

describe('generateSku', () => {
  it('upper-cases the slug and appends a dash and the random suffix', () => {
    const { source } = fixedBytes(0, 1, 2, 3);
    expect(generateSku('royal-canin-sensible-2kg', source)).toBe(
      `ROYAL-CANIN-SENSIBLE-2KG-${SKU_ALPHABET.slice(0, 4)}`,
    );
  });

  it('trims the slug before deriving', () => {
    const { source } = fixedBytes(0, 0, 0, 0);
    expect(generateSku('  toy-ball  ', source)).toBe(
      `TOY-BALL-${SKU_ALPHABET[0].repeat(SKU_SUFFIX_LENGTH)}`,
    );
  });

  it('asks for exactly one random byte per suffix character', () => {
    const { source, requested } = fixedBytes(9, 9, 9, 9);
    generateSku('abc', source);
    expect(requested).toEqual([SKU_SUFFIX_LENGTH]);
  });

  it('maps every byte value into the alphabet, evenly', () => {
    // 256 divisible by the alphabet size means `byte % size` has no bias.
    expect(256 % SKU_ALPHABET.length).toBe(0);
    for (let byte = 0; byte < 256; byte++) {
      const { source } = fixedBytes(byte, byte, byte, byte);
      const suffix = generateSku('abc', source).slice(-SKU_SUFFIX_LENGTH);
      expect(suffix).toBe(SKU_ALPHABET[byte % SKU_ALPHABET.length].repeat(4));
    }
  });

  it('leaves out characters that are easy to misread', () => {
    for (const lookalike of ['0', 'O', '1', 'I']) {
      expect(SKU_ALPHABET).not.toContain(lookalike);
    }
  });

  it('uses real randomness by default', () => {
    expect(generateSku('abc')).toMatch(
      new RegExp(`^ABC-[${SKU_ALPHABET}]{${SKU_SUFFIX_LENGTH}}$`),
    );
  });

  it('fits the SKU cap for the longest allowed slug', () => {
    const { source } = fixedBytes(0, 0, 0, 0);
    expect(generateSku('a'.repeat(MAX_SLUG_LENGTH), source)).toHaveLength(
      MAX_SKU_LENGTH,
    );
  });
});

describe('skuPreview', () => {
  it('shows the derived part with a placeholder for the random suffix', () => {
    expect(skuPreview('royal-canin')).toBe(
      `ROYAL-CANIN-${'?'.repeat(SKU_SUFFIX_LENGTH)}`,
    );
  });

  it('is empty until a slug is typed', () => {
    expect(skuPreview('')).toBe('');
    expect(skuPreview('   ')).toBe('');
  });
});
