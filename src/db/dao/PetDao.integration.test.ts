// Needs a live database — see src/db/test-db.ts. Owner-scoping is enforced in SQL
// (every read/write ANDs the session userId), so it cannot be proven against a
// mocked db — the cross-user (IDOR) cases below are the point of this suite.
import { afterEach, describe, expect, it } from 'vitest';
import { PET_GENDERS } from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { AccountFixtures } from '@/db/account-test-fixtures';

const { PetDao } = await importWithDb(() => import('@/db/dao/PetDao'));

const petInput = (over: Record<string, unknown> = {}) => ({
  name: 'لونا',
  type: PET_TYPES.CAT,
  gender: PET_GENDERS.FEMALE,
  neutered: true,
  breed: 'ایرانی',
  age: '۳ سال',
  weight: '۴ کیلو',
  photoUrl: undefined,
  ...over,
});

describe.skipIf(!databaseReachable)('PetDao', () => {
  const fx = new AccountFixtures();
  afterEach(() => fx.cleanup());

  it('creates a pet owned by the session user, defaulting optional fields to null', async () => {
    const user = await fx.user();
    const pet = await PetDao.create(user.id, petInput({ breed: undefined }));

    expect(pet.userId).toBe(user.id);
    expect(pet.name).toBe('لونا');
    expect(pet.type).toBe('cat');
    expect(pet.gender).toBe('female');
    expect(pet.neutered).toBe(true);
    expect(pet.breed).toBeNull();
    expect(pet.age).toBe('۳ سال');
  });

  it('lists only the owner’s pets, oldest first', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    await PetDao.create(owner.id, petInput({ name: 'اولی' }));
    await PetDao.create(owner.id, petInput({ name: 'دومی' }));
    await PetDao.create(other.id, petInput({ name: 'مال دیگری' }));

    const list = await PetDao.listByUser(owner.id);
    expect(list.map((p) => p.name)).toEqual(['اولی', 'دومی']);
  });

  describe('cross-user isolation (IDOR)', () => {
    it('update does not touch another user’s pet and returns null', async () => {
      const owner = await fx.user();
      const attacker = await fx.user();
      const pet = await PetDao.create(owner.id, petInput({ name: 'اصلی' }));

      const result = await PetDao.update(
        pet.id,
        attacker.id,
        petInput({ name: 'هک‌شده' }),
      );
      expect(result).toBeNull();

      // The row is untouched — the owner still reads the original name.
      const reread = (await PetDao.listByUser(owner.id)).find(
        (p) => p.id === pet.id,
      );
      expect(reread?.name).toBe('اصلی');
    });

    it('delete does not remove another user’s pet and returns false', async () => {
      const owner = await fx.user();
      const attacker = await fx.user();
      const pet = await PetDao.create(owner.id, petInput());

      expect(await PetDao.delete(pet.id, attacker.id)).toBe(false);
      expect(
        (await PetDao.listByUser(owner.id)).find((p) => p.id === pet.id),
      ).toBeDefined();
    });
  });

  it('updates a pet the caller owns, clearing a now-empty optional field', async () => {
    const user = await fx.user();
    const pet = await PetDao.create(user.id, petInput({ breed: 'ایرانی' }));

    const updated = await PetDao.update(
      pet.id,
      user.id,
      petInput({ name: 'لونای جدید', breed: undefined }),
    );
    expect(updated?.name).toBe('لونای جدید');
    // A full replace: the previously-set breed is now null, not left stale.
    expect(updated?.breed).toBeNull();
  });

  it('deletes a pet the caller owns', async () => {
    const user = await fx.user();
    const pet = await PetDao.create(user.id, petInput());
    expect(await PetDao.delete(pet.id, user.id)).toBe(true);
    expect(
      (await PetDao.listByUser(user.id)).find((p) => p.id === pet.id),
    ).toBeUndefined();
  });

  it('counts only the owner’s pets', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    await PetDao.create(owner.id, petInput());
    await PetDao.create(owner.id, petInput());
    await PetDao.create(other.id, petInput());
    expect(await PetDao.countForUser(owner.id)).toBe(2);
  });
});
