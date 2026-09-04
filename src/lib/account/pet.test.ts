// Pure schema behaviour — no database. The null byte is constructed with
// `String.fromCharCode(0)`, never typed (the project's control-character rule).
import { describe, expect, it } from 'vitest';
import { PET_GENDERS, petInputSchema } from '@/lib/account/pet';
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
