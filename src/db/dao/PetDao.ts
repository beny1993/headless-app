// All Drizzle DB access goes through DAOs like this one. Never write raw SQL.
//
// Every method here is owner-scoped: the `userId` comes from the authenticated
// session (the route passes `c.get('user').id`), and it is part of the `WHERE` on
// every read AND every write. That is the IDOR defence — a pet id in the URL can
// never reach a row that belongs to someone else, because the query also demands
// the row's `user_id` match the caller. `getOwned` / `update` / `delete` return
// `null` / `false` for "not yours", indistinguishable from "does not exist", so
// the API answers 404 either way and never confirms another user's pet exists.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { pets, type Pet } from '@/db/schema/account';
import type { PetInput } from '@/lib/account/pet';

/** Optional free-text fields → explicit NULL, so an update is a true full replace. */
const columns = (input: PetInput) => ({
  name: input.name,
  type: input.type,
  gender: input.gender,
  neutered: input.neutered,
  breed: input.breed ?? null,
  age: input.age ?? null,
  weight: input.weight ?? null,
  photoUrl: input.photoUrl ?? null,
});

export class PetDao {
  /** This user's pets, oldest first (stable insertion order for the list UI). */
  static async listByUser(userId: string): Promise<Pet[]> {
    return db
      .select()
      .from(pets)
      .where(eq(pets.userId, userId))
      .orderBy(asc(pets.createdAt), asc(pets.id));
  }

  /**
   * One pet the caller owns, or `null`. The `userId` is ANDed into the lookup, so
   * another user's pet id returns `null` — never their row.
   */
  static async getOwned(id: string, userId: string): Promise<Pet | null> {
    const [row] = await db
      .select()
      .from(pets)
      .where(and(eq(pets.id, id), eq(pets.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Insert a pet for `userId`. The owner is set from the session, never the body. */
  static async create(userId: string, input: PetInput): Promise<Pet> {
    const [row] = await db
      .insert(pets)
      .values({ userId, ...columns(input) })
      .returning();
    return row;
  }

  /**
   * Full-replace update, owner-scoped. Returns the updated row, or `null` when no
   * row matched — the pet does not exist, or is not this user's. `updatedAt` is
   * bumped by the schema's `$onUpdate`.
   */
  static async update(
    id: string,
    userId: string,
    input: PetInput,
  ): Promise<Pet | null> {
    const [row] = await db
      .update(pets)
      .set(columns(input))
      .where(and(eq(pets.id, id), eq(pets.userId, userId)))
      .returning();
    return row ?? null;
  }

  /**
   * Hard-delete, owner-scoped. Returns `true` when a row was removed, `false`
   * when nothing matched (missing, or not this user's). Hard-delete is correct
   * here: a pet is personal data with no history to preserve.
   */
  static async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(pets)
      .where(and(eq(pets.id, id), eq(pets.userId, userId)))
      .returning({ id: pets.id });
    return deleted.length > 0;
  }

  /** How many pets `userId` holds — the input to the per-user cap in the route. */
  static async countForUser(userId: string): Promise<number> {
    return db.$count(pets, eq(pets.userId, userId));
  }
}
