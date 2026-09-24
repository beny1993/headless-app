// Pure schema behaviour — no database. The null byte is constructed with
// `String.fromCharCode(0)`, never typed (the project's control-character rule).
//
// This schema is DERIVED from checkout's `addressSchema`, so the checkout-body
// tests already pin the province/null-byte/empty-field behaviour. These add only
// what the derivation itself introduces: the optional `title`, and that the
// inherited rules did not get lost in `.extend`.
import { describe, expect, it } from 'vitest';
import type { AddressWithProvince } from '@/db/dao/AddressDao';
import {
  addressInputSchema,
  normalizePostalCode,
  toAddressResponse,
  validateAddress,
} from '@/lib/account/address';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';

const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);

const valid = () => ({
  title: 'خانه',
  recipientName: 'سارا محمدی',
  recipientPhone: '09120000000',
  provinceId: 1,
  city: 'تهران',
  postalCode: '1234567890',
  addressLine: 'خیابان ولیعصر، پلاک ۱۲',
});

describe('addressInputSchema', () => {
  it('rejects a bidi override in the saved-address title', () => {
    expect(
      addressInputSchema.safeParse({ ...valid(), title: `خانه${RLO}` }).success,
    ).toBe(false);
  });

  it('accepts a full, well-formed address', () => {
    const parsed = addressInputSchema.parse(valid());
    expect(parsed.title).toBe('خانه');
    expect(parsed.provinceId).toBe(1);
    expect(parsed.recipientName).toBe('سارا محمدی');
  });

  it('makes the title optional and collapses an empty one to undefined', () => {
    const { title: _omit, ...noTitle } = valid();
    expect(addressInputSchema.parse(noTitle).title).toBeUndefined();
    expect(addressInputSchema.parse({ ...valid(), title: '   ' }).title).toBe(
      undefined,
    );
  });

  it('rejects an over-long title', () => {
    expect(
      addressInputSchema.safeParse({ ...valid(), title: 'ت'.repeat(61) })
        .success,
    ).toBe(false);
  });

  it('still requires provinceId (inherited from the checkout contract)', () => {
    const { provinceId: _omit, ...noProvince } = valid();
    expect(addressInputSchema.safeParse(noProvince).success).toBe(false);
  });

  it('still rejects a null byte in a text field (inherited)', () => {
    expect(
      addressInputSchema.safeParse({ ...valid(), city: `x${NUL}y` }).success,
    ).toBe(false);
  });

  it('still rejects an empty required field (inherited)', () => {
    expect(
      addressInputSchema.safeParse({ ...valid(), recipientName: '  ' }).success,
    ).toBe(false);
  });

  it('does not coerce a string provinceId (inherited int4/number stance)', () => {
    expect(
      addressInputSchema.safeParse({ ...valid(), provinceId: '1' }).success,
    ).toBe(false);
  });
});

// The wire projection the `/api/me/addresses` routes, the account book and the
// checkout prefill all render from.
describe('toAddressResponse', () => {
  const row: AddressWithProvince = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'user-1',
    title: null,
    recipientName: 'بنیامین',
    recipientPhone: '+989121234567',
    provinceId: 8,
    provinceName: 'تهران',
    city: 'تهران',
    postalCode: '1234567890',
    addressLine: 'خیابان آزادی، پلاک ۱',
    createdAt: new Date('2026-03-21T06:30:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  };

  it('ISOs the creation date and carries the joined province name', () => {
    expect(toAddressResponse(row)).toEqual({
      id: row.id,
      title: null,
      recipientName: 'بنیامین',
      recipientPhone: '+989121234567',
      provinceId: 8,
      provinceName: 'تهران',
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان آزادی، پلاک ۱',
      createdAt: '2026-03-21T06:30:00.000Z',
    });
  });

  it('drops the owner id and the update timestamp', () => {
    const projected = toAddressResponse(row) as Record<string, unknown>;
    expect(projected).not.toHaveProperty('userId');
    expect(projected).not.toHaveProperty('updatedAt');
  });
});

describe('normalizePostalCode', () => {
  it('folds Persian digits to ASCII', () => {
    expect(normalizePostalCode('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
  });

  it('strips separators and spaces', () => {
    expect(normalizePostalCode(' 12345-67890 ')).toBe('1234567890');
  });

  it('returns an empty string for no digits', () => {
    expect(normalizePostalCode('')).toBe('');
    expect(normalizePostalCode('کد')).toBe('');
  });
});

describe('validateAddress', () => {
  const form = () => ({
    recipientName: 'سارا محمدی',
    recipientPhone: '09120000000',
    provinceId: '1',
    city: 'تهران',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
    addressLine: 'خیابان ولیعصر، پلاک ۱۲',
  });

  it('accepts a complete address', () => {
    expect(validateAddress(form(), false)).toEqual({});
  });

  it('names every missing field in Persian', () => {
    expect(
      validateAddress(
        {
          recipientName: ' ',
          recipientPhone: '',
          provinceId: '',
          city: '  ',
          postalCode: '',
          addressLine: '',
        },
        false,
      ),
    ).toEqual({
      recipientName: 'نام گیرنده را وارد کن.',
      recipientPhone: 'شماره تماس گیرنده را وارد کن.',
      provinceId: 'استان را انتخاب کن.',
      city: 'شهر را وارد کن.',
      postalCode: 'کد پستی باید ۱۰ رقم باشد.',
      addressLine: 'آدرس کامل را وارد کن (حداقل ۱۰ حرف).',
    });
  });

  it('wants at least ten characters of address, after trimming', () => {
    expect(
      validateAddress({ ...form(), addressLine: ' ۱۲۳۴۵۶۷۸۹ ' }, false),
    ).toHaveProperty('addressLine');
    expect(
      validateAddress({ ...form(), addressLine: '۱۲۳۴۵۶۷۸۹۰' }, false),
    ).toEqual({});
  });

  it('wants exactly ten postal-code digits, separators ignored', () => {
    expect(
      validateAddress({ ...form(), postalCode: '12345-67890' }, false),
    ).toEqual({});
    expect(
      validateAddress({ ...form(), postalCode: '123456789' }, false),
    ).toHaveProperty('postalCode');
    expect(
      validateAddress({ ...form(), postalCode: '12345678901' }, false),
    ).toHaveProperty('postalCode');
  });

  it('refuses a deactivated province', () => {
    expect(validateAddress(form(), true)).toEqual({
      provinceId: STALE_PROVINCE_MESSAGE,
    });
  });

  it('asks for a province before calling an empty one stale', () => {
    expect(
      validateAddress({ ...form(), provinceId: '' }, true).provinceId,
    ).toBe('استان را انتخاب کن.');
  });
});
