// The read behind the admin user detail page: one account's profile with its
// orders, saved addresses and pets. Four DAOs, so it lives in src/logic/, like
// get-admin-order.ts. Not owner-scoped: the page's `requireAdmin` has
// authorized an admin to read any customer.
//
// A DELIBERATE PROJECTION. The page shows the fields below and nothing else, so
// nothing else is returned. In particular a pet's `photoUrl` is dropped: it is
// a URL the customer typed, and rendering it would have every admin who opens
// the page fetch a host that customer chose, handing it their IP and the time
// they looked. The email and every Better Auth session or account field are
// already absent from `UserDao.findForAdmin`'s projection.
import { AddressDao, type AddressWithProvince } from '@/db/dao/AddressDao';
import { OrderDao, type OrderSummaryRow } from '@/db/dao/OrderDao';
import { PetDao } from '@/db/dao/PetDao';
import { UserDao, type AdminUserRow } from '@/db/dao/UserDao';
import type { Pet } from '@/db/schema/account';

/** A saved address as the admin detail shows it. */
export type AdminUserAddress = Pick<
  AddressWithProvince,
  | 'id'
  | 'title'
  | 'recipientName'
  | 'provinceName'
  | 'city'
  | 'addressLine'
  | 'postalCode'
>;

/** A pet as the admin detail shows it: never its photo URL. */
export type AdminUserPet = Pick<
  Pet,
  'id' | 'name' | 'type' | 'gender' | 'neutered' | 'breed' | 'age' | 'weight'
>;

export type AdminUserDetail = {
  user: AdminUserRow;
  /** Newest first, as the account's own order history lists them. */
  orders: OrderSummaryRow[];
  addresses: AdminUserAddress[];
  pets: AdminUserPet[];
};

/** One user in full for the admin, or `null` when no user has that id. */
export const getAdminUser = async (
  id: string,
): Promise<AdminUserDetail | null> => {
  const user = await UserDao.findForAdmin(id);
  if (!user) return null;

  const [orders, addresses, pets] = await Promise.all([
    OrderDao.listByUser(id),
    AddressDao.listByUser(id),
    PetDao.listByUser(id),
  ]);

  return {
    user,
    orders,
    addresses: addresses.map((address) => ({
      id: address.id,
      title: address.title,
      recipientName: address.recipientName,
      provinceName: address.provinceName,
      city: address.city,
      addressLine: address.addressLine,
      postalCode: address.postalCode,
    })),
    pets: pets.map((pet) => ({
      id: pet.id,
      name: pet.name,
      type: pet.type,
      gender: pet.gender,
      neutered: pet.neutered,
      breed: pet.breed,
      age: pet.age,
      weight: pet.weight,
    })),
  };
};
