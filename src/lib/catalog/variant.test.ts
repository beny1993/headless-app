import { describe, expect, it } from 'vitest';
import {
  VARIANT_LABEL_LIMIT,
  VARIANT_MESSAGES,
  displayTitle,
  isFamilyMember,
} from './variant';

describe('displayTitle', () => {
  it('returns the plain title when there is no label', () => {
    expect(displayTitle({ title: 'غذای خشک سگ', variantLabel: null })).toBe(
      'غذای خشک سگ',
    );
  });

  it('joins the title and the label with an em dash', () => {
    expect(
      displayTitle({ title: 'غذای خشک سگ', variantLabel: '۱۰ کیلوگرم' }),
    ).toBe('غذای خشک سگ — ۱۰ کیلوگرم');
  });

  it('treats a missing label like an absent one', () => {
    expect(displayTitle({ title: 'توپ بازی' })).toBe('توپ بازی');
  });

  it('ignores a label that is only whitespace', () => {
    expect(displayTitle({ title: 'توپ بازی', variantLabel: '   ' })).toBe(
      'توپ بازی',
    );
  });

  it('trims around the label it appends', () => {
    expect(displayTitle({ title: 'توپ بازی', variantLabel: '  قرمز  ' })).toBe(
      'توپ بازی — قرمز',
    );
  });

  it('trims the title too, so a stored stray space cannot double the separator', () => {
    expect(displayTitle({ title: 'توپ بازی ', variantLabel: 'قرمز' })).toBe(
      'توپ بازی — قرمز',
    );
  });

  it('keeps a label that is only digits', () => {
    expect(displayTitle({ title: 'قلاده', variantLabel: '۲' })).toBe(
      'قلاده — ۲',
    );
  });
});

describe('isFamilyMember', () => {
  it('is false for a standalone product', () => {
    expect(isFamilyMember({ variantOf: null })).toBe(false);
  });

  it('is false for a head, which points at nothing itself', () => {
    expect(isFamilyMember({ variantOf: null, variantLabel: 'لاوندر' })).toBe(
      false,
    );
  });

  it('is true for a row that points at a head', () => {
    expect(
      isFamilyMember({ variantOf: '11111111-1111-4111-8111-111111111111' }),
    ).toBe(true);
  });
});

describe('the label limit and messages', () => {
  it('bounds the label, because it renders on the card and the order line', () => {
    expect(VARIANT_LABEL_LIMIT).toBeGreaterThan(0);
    expect(VARIANT_LABEL_LIMIT).toBeLessThanOrEqual(60);
  });

  it('says every refusal in Persian', () => {
    for (const message of Object.values(VARIANT_MESSAGES)) {
      expect(message).toMatch(/[؀-ۿ]/);
    }
  });
});
