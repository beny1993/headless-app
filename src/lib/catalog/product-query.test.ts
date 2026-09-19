import { describe, expect, it } from 'vitest';
import {
  PET_EMOJI,
  PET_LABELS,
  PET_TYPES,
  PET_TYPE_VALUES,
  formatPetTypes,
  normalizePetTypes,
} from './product-query';

describe('normalizePetTypes', () => {
  it('keeps the canonical order whatever order the caller sends', () => {
    expect(normalizePetTypes([PET_TYPES.DOG, PET_TYPES.CAT])).toEqual([
      PET_TYPES.CAT,
      PET_TYPES.DOG,
    ]);
    expect(normalizePetTypes([PET_TYPES.CAT, PET_TYPES.DOG])).toEqual([
      PET_TYPES.CAT,
      PET_TYPES.DOG,
    ]);
  });

  it('dedupes a repeated value', () => {
    expect(normalizePetTypes([PET_TYPES.CAT, PET_TYPES.CAT])).toEqual([
      PET_TYPES.CAT,
    ]);
  });

  it('answers an empty selection with an empty list', () => {
    expect(normalizePetTypes([])).toEqual([]);
  });

  it('is its own fixed point', () => {
    const once = normalizePetTypes([PET_TYPES.DOG, PET_TYPES.CAT]);
    expect(normalizePetTypes(once)).toEqual(once);
  });

  it('matches the enum, so a new pet type cannot be forgotten here', () => {
    expect(PET_TYPE_VALUES).toEqual(Object.values(PET_TYPES));
    expect(normalizePetTypes(PET_TYPE_VALUES)).toEqual([...PET_TYPE_VALUES]);
  });
});

describe('the Persian words for the pet enum', () => {
  it('names one pet with its own label', () => {
    expect(formatPetTypes([PET_TYPES.CAT])).toBe(PET_LABELS[PET_TYPES.CAT]);
    expect(formatPetTypes([PET_TYPES.DOG])).toBe(PET_LABELS[PET_TYPES.DOG]);
  });

  it('joins both pets in the canonical order, whatever order it is given', () => {
    expect(formatPetTypes([PET_TYPES.CAT, PET_TYPES.DOG])).toBe('گربه و سگ');
    expect(formatPetTypes([PET_TYPES.DOG, PET_TYPES.CAT])).toBe('گربه و سگ');
  });

  it('has a word and a face for every value of the enum', () => {
    // The point of keeping them beside `PET_TYPE_VALUES`: a third pet type
    // fails here rather than rendering a bare `cat` on a page.
    for (const value of PET_TYPE_VALUES) {
      expect(PET_LABELS[value]).toBeTruthy();
      expect(PET_EMOJI[value]).toBeTruthy();
    }
  });
});
