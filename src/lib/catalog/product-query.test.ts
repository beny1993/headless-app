import { describe, expect, it } from 'vitest';
import { PET_TYPES, PET_TYPE_VALUES, normalizePetTypes } from './product-query';

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
