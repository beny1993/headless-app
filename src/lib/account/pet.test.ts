// Pure schema behaviour — no database. The null byte is constructed with
// `String.fromCharCode(0)`, never typed (the project's control-character rule).
import { describe, expect, it } from 'vitest';
import type { Pet } from '@/db/schema/account';
import {
  PET_GENDERS,
  isHttpsUrl,
  petInputSchema,
  toPetResponse,
} from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';

const NUL = String.fromCharCode(0);

const valid = () => ({
  name: 'لونا',
  type: PET_TYPES.CAT,
  gender: PET_GENDERS.FEMALE,
  neutered: true,
  breed: 'ایرانی',
  age: '۳ سال',
  weight: '۴ کیلو',
  photoUrl: 'https://cdn.example.com/luna.jpg',
});

describe('petInputSchema', () => {
  it('accepts a full, well-formed pet', () => {
    const parsed = petInputSchema.parse(valid());
    expect(parsed.name).toBe('لونا');
    expect(parsed.type).toBe('cat');
    expect(parsed.gender).toBe('female');
    expect(parsed.neutered).toBe(true);
  });

  it('accepts a minimal pet with only the required fields', () => {
    const parsed = petInputSchema.parse({
      name: 'رکس',
      type: PET_TYPES.DOG,
      gender: PET_GENDERS.MALE,
      neutered: false,
    });
    expect(parsed.breed).toBeUndefined();
    expect(parsed.age).toBeUndefined();
    expect(parsed.weight).toBeUndefined();
    expect(parsed.photoUrl).toBeUndefined();
  });

  it('collapses empty optional fields to undefined', () => {
    const parsed = petInputSchema.parse({
      ...valid(),
      breed: '',
      age: '   ',
      photoUrl: '',
    });
    expect(parsed.breed).toBeUndefined();
    expect(parsed.age).toBeUndefined();
    expect(parsed.photoUrl).toBeUndefined();
  });

  it('requires a non-empty name', () => {
    expect(petInputSchema.safeParse({ ...valid(), name: '   ' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown type or gender', () => {
    expect(
      petInputSchema.safeParse({ ...valid(), type: 'parrot' }).success,
    ).toBe(false);
    expect(
      petInputSchema.safeParse({ ...valid(), gender: 'other' }).success,
    ).toBe(false);
  });

  it('requires neutered to be a boolean', () => {
    expect(
      petInputSchema.safeParse({ ...valid(), neutered: 'yes' }).success,
    ).toBe(false);
    expect(
      petInputSchema.safeParse({ ...valid(), neutered: undefined }).success,
    ).toBe(false);
  });

  it('rejects a null byte in a text field (would 500 in the pg driver)', () => {
    expect(
      petInputSchema.safeParse({ ...valid(), name: `x${NUL}y` }).success,
    ).toBe(false);
  });

  describe('photoUrl (attacker-controllable, later rendered)', () => {
    it('accepts an https URL', () => {
      expect(petInputSchema.parse(valid()).photoUrl).toBe(
        'https://cdn.example.com/luna.jpg',
      );
    });

    it('rejects a non-https scheme', () => {
      for (const bad of [
        'http://cdn.example.com/x.jpg',
        'javascript:alert(1)',
        'data:image/png;base64,iVBOR',
        'not a url',
      ]) {
        expect(
          petInputSchema.safeParse({ ...valid(), photoUrl: bad }).success,
        ).toBe(false);
      }
    });
  });

  describe('isHttpsUrl (render-time guard, defense in depth)', () => {
    it('is true only for a real https URL', () => {
      expect(isHttpsUrl('https://cdn.example.com/x.jpg')).toBe(true);
    });

    it('is false for a non-https scheme, garbage, or nullish', () => {
      for (const bad of [
        'http://cdn.example.com/x.jpg',
        'javascript:alert(1)',
        'data:image/png;base64,iVBOR',
        'not a url',
        '',
        null,
        undefined,
      ]) {
        expect(isHttpsUrl(bad)).toBe(false);
      }
    });
  });

  it('strips a client-supplied id / userId (mass-assignment gate)', () => {
    const parsed = petInputSchema.parse({
      ...valid(),
      id: 'smuggled',
      userId: 'someone-else',
    }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('userId');
  });
});

// The wire projection the `/api/me/pets` routes and the account server page both
// render from. It drops the columns a client must never see and ISOs the date —
// a `Date` on the wire is whatever `JSON.stringify` felt like that day.
describe('toPetResponse', () => {
  const row: Pet = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    name: 'لونا',
    type: PET_TYPES.CAT,
    gender: PET_GENDERS.FEMALE,
    neutered: true,
    breed: null,
    age: '۳ سال',
    weight: null,
    photoUrl: null,
    createdAt: new Date('2026-03-21T06:30:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  };

  it('ISOs the creation date and keeps every public field', () => {
    expect(toPetResponse(row)).toEqual({
      id: row.id,
      name: 'لونا',
      type: PET_TYPES.CAT,
      gender: PET_GENDERS.FEMALE,
      neutered: true,
      breed: null,
      age: '۳ سال',
      weight: null,
      photoUrl: null,
      createdAt: '2026-03-21T06:30:00.000Z',
    });
  });

  it('drops the owner id and the update timestamp', () => {
    const projected = toPetResponse(row) as Record<string, unknown>;
    expect(projected).not.toHaveProperty('userId');
    expect(projected).not.toHaveProperty('updatedAt');
  });
});
