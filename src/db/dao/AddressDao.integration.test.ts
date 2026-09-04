// Needs a live database — see src/db/test-db.ts. Owner-scoping is SQL-enforced,
// so the cross-user (IDOR) cases are the point of this suite; the province join
// and the hard-delete-vs-order-history independence also need a real database.
import { afterEach, describe, expect, it } from 'vitest';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { AccountFixtures } from '@/db/account-test-fixtures';

const { AddressDao } = await importWithDb(() => import('@/db/dao/AddressDao'));

describe.skipIf(!databaseReachable)('AddressDao', () => {
  const fx = new AccountFixtures();
  afterEach(() => fx.cleanup());

  const addressInput = (
    provinceId: number,
    over: Record<string, unknown> = {},
  ) => ({
    title: 'خانه',
    recipientName: 'سارا محمدی',
    recipientPhone: '09120000000',
    provinceId,
    city: 'تهران',
    postalCode: '1234567890',
    addressLine: 'خیابان ولیعصر، پلاک ۱۲',
    ...over,
  });

  it('creates an address for the session user and returns it joined to its province name', async () => {
    const user = await fx.user();
    // A unique name — `provinces` is seeded, so real names like «تهران» collide.
    const province = await fx.province();
    const created = await AddressDao.create(user.id, addressInput(province.id));

    expect(created.userId).toBe(user.id);
    expect(created.provinceId).toBe(province.id);
    expect(created.provinceName).toBe(province.name);
    expect(created.title).toBe('خانه');
  });

  it('defaults an absent title to null', async () => {
    const user = await fx.user();
    const province = await fx.province();
    const created = await AddressDao.create(
      user.id,
      addressInput(province.id, { title: undefined }),
    );
    expect(created.title).toBeNull();
  });

  it('lists only the owner’s addresses, oldest first', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    const province = await fx.province();
    await AddressDao.create(
      owner.id,
      addressInput(province.id, { title: 'یک' }),
    );
    await AddressDao.create(
      owner.id,
      addressInput(province.id, { title: 'دو' }),
    );
    await AddressDao.create(
      other.id,
      addressInput(province.id, { title: 'دیگری' }),
    );

    const list = await AddressDao.listByUser(owner.id);
    expect(list.map((a) => a.title)).toEqual(['یک', 'دو']);
  });

  describe('cross-user isolation (IDOR)', () => {
    it('getOwned returns null for another user’s address', async () => {
      const owner = await fx.user();
      const attacker = await fx.user();
      const province = await fx.province();
      const address = await AddressDao.create(
        owner.id,
        addressInput(province.id),
      );

      expect(await AddressDao.getOwned(address.id, attacker.id)).toBeNull();
    });

    it('update does not touch another user’s address and returns null', async () => {
      const owner = await fx.user();
      const attacker = await fx.user();
      const province = await fx.province();
      const address = await AddressDao.create(
        owner.id,
        addressInput(province.id, { city: 'تهران' }),
      );

      const result = await AddressDao.update(
        address.id,
        attacker.id,
        addressInput(province.id, { city: 'شیراز' }),
      );
      expect(result).toBeNull();

      const reread = await AddressDao.getOwned(address.id, owner.id);
      expect(reread?.city).toBe('تهران');
    });

    it('delete does not remove another user’s address and returns false', async () => {
      const owner = await fx.user();
      const attacker = await fx.user();
      const province = await fx.province();
      const address = await AddressDao.create(
        owner.id,
        addressInput(province.id),
      );

      expect(await AddressDao.delete(address.id, attacker.id)).toBe(false);
      expect(await AddressDao.getOwned(address.id, owner.id)).not.toBeNull();
    });
  });

  it('updates an address the caller owns', async () => {
    const user = await fx.user();
    const province = await fx.province();
    const address = await AddressDao.create(
      user.id,
      addressInput(province.id, { city: 'تهران' }),
    );

    const updated = await AddressDao.update(
      address.id,
      user.id,
      addressInput(province.id, { city: 'کرج', title: undefined }),
    );
    expect(updated?.city).toBe('کرج');
    expect(updated?.title).toBeNull();
  });

  it('deletes an address the caller owns', async () => {
    const user = await fx.user();
    const province = await fx.province();
    const address = await AddressDao.create(user.id, addressInput(province.id));
    expect(await AddressDao.delete(address.id, user.id)).toBe(true);
    expect(await AddressDao.getOwned(address.id, user.id)).toBeNull();
  });

  it('counts only the owner’s addresses', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    const province = await fx.province();
    await AddressDao.create(owner.id, addressInput(province.id));
    await AddressDao.create(other.id, addressInput(province.id));
    expect(await AddressDao.countForUser(owner.id)).toBe(1);
  });
});
