// All Drizzle DB access goes through DAOs like this one. Never write raw SQL.
//
// Owner-scoped exactly like `PetDao`: the `userId` from the session is part of the
// `WHERE` on every read and write, so an address id in a URL can never reach
// someone else's row. "Not yours" and "does not exist" are the same `null`/`false`
// answer, which the API turns into one 404.
//
// Reads return the address joined to its province name (an `innerJoin`, sound
// because `province_id` is NOT NULL with a `restrict` FK, so it always resolves) —
// the shape the address book and the checkout picker render. The address stores a
// live `province_id`, not a snapshot: it is editable reference-linked data, not an
// order's frozen record.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { addresses, type Address } from '@/db/schema/account';
import { provinces } from '@/db/schema/shipping';
import type { AddressInput } from '@/lib/account/address';

/** An address with its province's display name — the shape every read returns. */
export type AddressWithProvince = Address & { provinceName: string };

const selection = {
  id: addresses.id,
  userId: addresses.userId,
  title: addresses.title,
  recipientName: addresses.recipientName,
  recipientPhone: addresses.recipientPhone,
  provinceId: addresses.provinceId,
  provinceName: provinces.name,
  city: addresses.city,
  postalCode: addresses.postalCode,
  addressLine: addresses.addressLine,
  createdAt: addresses.createdAt,
  updatedAt: addresses.updatedAt,
};

const columns = (input: AddressInput) => ({
  title: input.title ?? null,
  recipientName: input.recipientName,
  recipientPhone: input.recipientPhone,
  provinceId: input.provinceId,
  city: input.city,
  postalCode: input.postalCode,
  addressLine: input.addressLine,
});

export class AddressDao {
  /** This user's addresses, oldest first, each with its province name. */
  static async listByUser(userId: string): Promise<AddressWithProvince[]> {
    return db
      .select(selection)
      .from(addresses)
      .innerJoin(provinces, eq(provinces.id, addresses.provinceId))
      .where(eq(addresses.userId, userId))
      .orderBy(asc(addresses.createdAt), asc(addresses.id));
  }

  /** One address the caller owns, joined to its province, or `null`. */
  static async getOwned(
    id: string,
    userId: string,
  ): Promise<AddressWithProvince | null> {
    const [row] = await db
      .select(selection)
      .from(addresses)
      .innerJoin(provinces, eq(provinces.id, addresses.provinceId))
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Insert an address for `userId`, then read it back joined to its province. */
  static async create(
    userId: string,
    input: AddressInput,
  ): Promise<AddressWithProvince> {
    const [row] = await db
      .insert(addresses)
      .values({ userId, ...columns(input) })
      .returning({ id: addresses.id });
    // Non-null: we just inserted it, and this user owns it.
    return (await AddressDao.getOwned(row.id, userId))!;
  }

  /**
   * Full-replace update, owner-scoped. Returns the updated row joined to its
   * province, or `null` when nothing matched (missing, or not this user's).
   */
  static async update(
    id: string,
    userId: string,
    input: AddressInput,
  ): Promise<AddressWithProvince | null> {
    const [row] = await db
      .update(addresses)
      .set(columns(input))
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .returning({ id: addresses.id });
    if (!row) return null;
    return AddressDao.getOwned(row.id, userId);
  }

  /**
   * Hard-delete, owner-scoped. Returns `true` when a row was removed. Deleting a
   * saved address never touches order history — an order keeps its own address
   * snapshot.
   */
  static async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .returning({ id: addresses.id });
    return deleted.length > 0;
  }

  /** How many addresses `userId` holds — the input to the per-user cap. */
  static async countForUser(userId: string): Promise<number> {
    return db.$count(addresses, eq(addresses.userId, userId));
  }
}
