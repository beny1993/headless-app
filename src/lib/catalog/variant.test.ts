import { describe, expect, it } from 'vitest';
import { toPersianDigits } from '@/lib/format';
import {
  VARIANT_LABEL_LIMIT,
  VARIANT_MESSAGES,
  displayTitle,
  hasMembersMessage,
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

describe('the label limit and messages', () => {
  it('bounds the label, because it renders on the card and the order line', () => {
    expect(VARIANT_LABEL_LIMIT).toBeGreaterThan(0);
    expect(VARIANT_LABEL_LIMIT).toBeLessThanOrEqual(60);
  });

  it('has a Persian sentence for every refusal reason', () => {
    // The key set, like `category-input.test.ts` next door: a reason added to
    // `VariantRuleReason` without copy fails here rather than at the DAO's
    // index site, where the failure is a `undefined` message on a real save.
    // `hasMembers` is not among them on purpose — its copy takes the count, so
    // it is `hasMembersMessage`, asserted below.
    expect(Object.keys(VARIANT_MESSAGES).sort()).toEqual([
      'headNeedsLabel',
      'inactiveHead',
      'label',
      'labelLength',
      'nested',
      'self',
      'unknownHead',
    ]);
    // `\p{Script=Arabic}`, not a hand-written character range: the range that
    // was here opened on a raw U+0600, an invisible byte typed into the source
    // where the project's rule says to construct one — and `lint` and
    // `format:check` passed straight over it.
    for (const message of Object.values(VARIANT_MESSAGES)) {
      expect(message).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it('counts the blocking members in Persian digits', () => {
    const message = hasMembersMessage(2);
    expect(message).toMatch(/\p{Script=Arabic}/u);
    expect(message).toContain(toPersianDigits(2));
    // Soft delete is the only delete there is, so the sentence cannot tell an
    // admin to delete the members.
    expect(message).toContain('غیرفعال');
  });
});
