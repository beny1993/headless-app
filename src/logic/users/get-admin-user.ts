// The read behind the admin user detail page: one account's profile with its
// orders and saved addresses. Three DAOs, so it lives in src/logic/, like
// get-admin-order.ts. Not owner-scoped: the page's `requireAdmin` has
// authorized an admin to read any customer.
//
// A DELIBERATE PROJECTION. The page shows the fields below and nothing else, so
// nothing else is returned. The email and every Better Auth session or account field are
// already absent from `UserDao.findForAdmin`'s projection.
import { AddressDao, type AddressWithProvince } from '@/db/dao/AddressDao';
import { OrderDao, type OrderSummaryRow } from '@/db/dao/OrderDao';
import { UserDao, type AdminUserRow } from '@/db/dao/UserDao';

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

export type AdminUserDetail = {
  user: AdminUserRow;
  /** Newest first, as the account's own order history lists them. */
  orders: OrderSummaryRow[];
  addresses: AdminUserAddress[];
};

/** One user in full for the admin, or `null` when no user has that id. */
export const getAdminUser = async (
  id: string,
): Promise<AdminUserDetail | null> => {
  const user = await UserDao.findForAdmin(id);
  if (!user) return null;

  const [orders, addresses] = await Promise.all([
    OrderDao.listByUser(id),
    AddressDao.listByUser(id),
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
  };
};
