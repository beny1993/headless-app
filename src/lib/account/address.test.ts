// Pure schema behaviour — no database. The null byte is constructed with
// `String.fromCharCode(0)`, never typed (the project's control-character rule).
//
// This schema is DERIVED from checkout's `addressSchema`, so the checkout-body
// tests already pin the province/null-byte/empty-field behaviour. These add only
// what the derivation itself introduces: the optional `title`, and that the
// inherited rules did not get lost in `.extend`.
import { describe, expect, it } from 'vitest';
import type { AddressWithProvince } from '@/db/dao/AddressDao';
import { addressInputSchema, toAddressResponse } from '@/lib/account/address';

const NUL = String.fromCharCode(0);

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
