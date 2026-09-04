import { describe, expect, it } from 'vitest';
import { parseFieldErrors } from './field-errors';

describe('parseFieldErrors', () => {
  it('maps a `path: message` entry to its field', () => {
    const { fields, unmapped } = parseFieldErrors([
      'address.provinceId: استان انتخاب‌شده نامعتبر است.',
    ]);
    expect(fields).toEqual({
      'address.provinceId': 'استان انتخاب‌شده نامعتبر است.',
    });
    expect(unmapped).toEqual([]);
  });

  it('splits on the first `: ` only, keeping a colon inside the message', () => {
    const { fields } = parseFieldErrors([
      'items.0: موجودی «غذای گربه»: کافی نیست',
    ]);
    expect(fields['items.0']).toBe('موجودی «غذای گربه»: کافی نیست');
  });

  it('treats a bare message with no field path as unmapped', () => {
    const { fields, unmapped } = parseFieldErrors(['یک خطای عمومی رخ داد']);
    expect(fields).toEqual({});
    expect(unmapped).toEqual(['یک خطای عمومی رخ داد']);
  });

  it('does not mistake a Persian sentence containing `: ` for a path', () => {
    // The part before the first `: ` is Persian text, not a dotted path, so the
    // whole entry is unmapped rather than mis-keyed under a garbage "field".
    const { fields, unmapped } = parseFieldErrors(['توجه: مشکلی پیش آمد']);
    expect(fields).toEqual({});
    expect(unmapped).toEqual(['توجه: مشکلی پیش آمد']);
  });

  it('keeps the first message when a path repeats', () => {
    const { fields } = parseFieldErrors(['items.0: اول', 'items.0: دوم']);
    expect(fields['items.0']).toBe('اول');
  });

  it('separates mapped fields from unmapped entries in one list', () => {
    const { fields, unmapped } = parseFieldErrors([
      'paymentMethod: روش پرداخت نامعتبر است.',
      'خطای کلی بدون فیلد',
    ]);
    expect(fields).toEqual({ paymentMethod: 'روش پرداخت نامعتبر است.' });
    expect(unmapped).toEqual(['خطای کلی بدون فیلد']);
  });

  it('returns empty buckets for undefined or an empty list', () => {
    expect(parseFieldErrors(undefined)).toEqual({ fields: {}, unmapped: [] });
    expect(parseFieldErrors([])).toEqual({ fields: {}, unmapped: [] });
  });
});
