import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, DEFAULT_ERROR_MESSAGE } from '@/lib/api-client';
import {
  parseFieldErrors,
  reasonFrom,
  requestFieldErrors,
  zodFieldErrors,
} from './field-errors';

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

describe('reasonFrom', () => {
  it('forwards the sentence of a 4xx refusal', () => {
    expect(reasonFrom(new ApiRequestError(404, 'محصول یافت نشد'))).toBe(
      'محصول یافت نشد',
    );
    expect(reasonFrom(new ApiRequestError(409, 'تکراری است'))).toBe(
      'تکراری است',
    );
  });

  it('keeps a 5xx message out of the UI', () => {
    expect(
      reasonFrom(new ApiRequestError(500, 'Internal server error')),
    ).toBeUndefined();
    expect(reasonFrom(new ApiRequestError(502, 'Bad gateway'))).toBeUndefined();
  });

  it('keeps anything that is not an API refusal out of the UI', () => {
    expect(reasonFrom(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(reasonFrom(new Error('boom'))).toBeUndefined();
    expect(reasonFrom('boom')).toBeUndefined();
    expect(reasonFrom(undefined)).toBeUndefined();
  });
});

describe('requestFieldErrors', () => {
  it('maps a 400, 409 or 422 onto fields and says nothing more', () => {
    for (const status of [400, 409, 422]) {
      expect(
        requestFieldErrors(
          new ApiRequestError(status, 'ورودی نامعتبر', ['slug: تکراری است']),
        ),
      ).toEqual({ fields: { slug: 'تکراری است' }, message: undefined });
    }
  });

  it('joins what no field can show into the message', () => {
    expect(
      requestFieldErrors(
        new ApiRequestError(400, 'ورودی نامعتبر', [
          'slug: تکراری است',
          'یک خطای عمومی',
          'خطای دیگر',
        ]),
      ),
    ).toEqual({
      fields: { slug: 'تکراری است' },
      message: 'یک خطای عمومی خطای دیگر',
    });
  });

  it('falls back to the envelope message when nothing is mappable', () => {
    expect(
      requestFieldErrors(new ApiRequestError(409, 'این نام قبلاً ثبت شده')),
    ).toEqual({ fields: {}, message: 'این نام قبلاً ثبت شده' });
  });

  it('shows another 4xx as the server wrote it, with no fields', () => {
    expect(
      requestFieldErrors(new ApiRequestError(403, 'دسترسی ندارید.', ['x: y'])),
    ).toEqual({ fields: {}, message: 'دسترسی ندارید.' });
  });

  it('replaces a 5xx or a dead connection with the fallback', () => {
    expect(
      requestFieldErrors(new ApiRequestError(500, 'Internal server error')),
    ).toEqual({ fields: {}, message: DEFAULT_ERROR_MESSAGE });
    expect(
      requestFieldErrors(new TypeError('Failed to fetch'), 'ذخیره نشد.'),
    ).toEqual({ fields: {}, message: 'ذخیره نشد.' });
  });
});

describe('zodFieldErrors', () => {
  const schema = z.object({
    title: z.string().min(1, 'عنوان لازم است').max(3, 'عنوان بلند است'),
    price: z.number('قیمت عدد است'),
    address: z.object({ city: z.string().min(1, 'شهر لازم است') }),
  });
  const fail = (value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) throw new Error('expected a failure');
    return parsed.error;
  };

  it('keeps the first message per top-level field', () => {
    expect(
      zodFieldErrors(fail({ title: '', price: 'x', address: { city: 'a' } })),
    ).toEqual({ title: 'عنوان لازم است', price: 'قیمت عدد است' });
  });

  it('files a nested issue under its top-level key', () => {
    expect(
      zodFieldErrors(fail({ title: 'a', price: 1, address: { city: '' } })),
    ).toEqual({ address: 'شهر لازم است' });
  });
});
