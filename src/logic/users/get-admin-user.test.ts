// The admin user detail's read, with its four DAOs mocked at the module edge:
// what it reads for which id, and the projection that keeps the customer-typed
// pet photo URL (and every field the page does not show) off the page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressWithProvince } from '@/db/dao/AddressDao';
import type { AdminUserRow } from '@/db/dao/UserDao';
import type { OrderSummaryRow } from '@/db/dao/OrderDao';
import type { Pet } from '@/db/schema/account';
import { PET_GENDERS } from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { getAdminUser } from './get-admin-user';

const dao = vi.hoisted(() => ({
  findForAdmin: vi.fn(),
  listOrders: vi.fn(),
  listAddresses: vi.fn(),
  listPets: vi.fn(),
}));
vi.mock('@/db/dao/UserDao', () => ({
  UserDao: { findForAdmin: dao.findForAdmin },
}));
vi.mock('@/db/dao/OrderDao', () => ({
  OrderDao: { listByUser: dao.listOrders },
}));
vi.mock('@/db/dao/AddressDao', () => ({
  AddressDao: { listByUser: dao.listAddresses },
}));
vi.mock('@/db/dao/PetDao', () => ({ PetDao: { listByUser: dao.listPets } }));

const ID = 'user-abc123';
const CREATED = new Date('2026-09-01T10:00:00Z');

const USER: AdminUserRow = {
  id: ID,
  name: 'سارا',
  phoneNumber: '+989121234567',
  role: 'customer',
  createdAt: CREATED,
  orderCount: 1,
  totalSpent: 250_000,
};

const ORDER: OrderSummaryRow = {
  id: '00000000-0000-4000-8000-000000000101',
  orderNo: 101,
  status: ORDER_STATUSES.PAID,
  paymentMethod: PAYMENT_METHODS.ZARINPAL,
  total: 250_000,
  createdAt: CREATED,
  itemCount: 1,
};

const ADDRESS: AddressWithProvince = {
  id: '00000000-0000-4000-8000-000000000201',
  userId: ID,
  title: 'خانه',
  recipientName: 'سارا محمدی',
  recipientPhone: '+989120000000',
  provinceId: 1,
  provinceName: 'تهران',
  city: 'تهران',
  postalCode: '1234567890',
  addressLine: 'خیابان آزادی، پلاک ۱۲',
  createdAt: CREATED,
  updatedAt: CREATED,
};

const PHOTO_URL = 'https://tracker.example/pixel.jpg';

const PET: Pet = {
  id: '00000000-0000-4000-8000-000000000301',
  userId: ID,
  name: 'اسموکی',
  type: PET_TYPES.CAT,
  gender: PET_GENDERS.MALE,
  neutered: true,
  breed: 'پرشین',
  age: '۳ سال',
  weight: '۴ کیلو',
  photoUrl: PHOTO_URL,
  createdAt: CREATED,
  updatedAt: CREATED,
};

beforeEach(() => {
  vi.clearAllMocks();
  dao.findForAdmin.mockResolvedValue(USER);
  dao.listOrders.mockResolvedValue([ORDER]);
  dao.listAddresses.mockResolvedValue([ADDRESS]);
  dao.listPets.mockResolvedValue([PET]);
});

describe('getAdminUser', () => {
  it('reads the user, then their orders, addresses and pets by the same id', async () => {
    const detail = await getAdminUser(ID);

    for (const read of [
      dao.findForAdmin,
      dao.listOrders,
      dao.listAddresses,
      dao.listPets,
    ]) {
      expect(read).toHaveBeenCalledWith(ID);
    }
    expect(detail).toMatchObject({ user: USER, orders: [ORDER] });
  });

  it('is null for an unknown id, and reads nothing else', async () => {
    dao.findForAdmin.mockResolvedValue(null);

    expect(await getAdminUser(ID)).toBeNull();
    expect(dao.listOrders).not.toHaveBeenCalled();
    expect(dao.listAddresses).not.toHaveBeenCalled();
    expect(dao.listPets).not.toHaveBeenCalled();
  });

  it('never carries the pet photo URL the customer typed', async () => {
    const detail = await getAdminUser(ID);

    expect(detail?.pets).toEqual([
      {
        id: PET.id,
        name: PET.name,
        type: PET.type,
        gender: PET.gender,
        neutered: PET.neutered,
        breed: PET.breed,
        age: PET.age,
        weight: PET.weight,
      },
    ]);
    expect(JSON.stringify(detail)).not.toContain(PHOTO_URL);
  });

  it('carries only the address fields the page shows', async () => {
    const detail = await getAdminUser(ID);

    expect(detail?.addresses).toEqual([
      {
        id: ADDRESS.id,
        title: ADDRESS.title,
        recipientName: ADDRESS.recipientName,
        provinceName: ADDRESS.provinceName,
        city: ADDRESS.city,
        addressLine: ADDRESS.addressLine,
        postalCode: ADDRESS.postalCode,
      },
    ]);
  });
});
