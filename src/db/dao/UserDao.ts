// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import { ROLES, users, type Role, type User } from '@/db/schema/auth';

export class UserDao {
  /**
   * Looks a customer up by phone number.
   *
   * `phone` must already be canonical (`+989xxxxxxxxx`) — this does not
   * normalize, deliberately: a lookup that quietly accepts `09121234567` would
   * hide the fact that the *write* path stores whatever it was given.
   */
  static async findByPhone(phone: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.phoneNumber, phone))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Every admin who can receive an SMS — the new-order alert's recipient list
   * (`src/logic/orders/notify-new-order.ts`). `role` is READ here and never
   * written: granting it stays `pnpm create-admin`'s job alone, which is also
   * what makes this list an admin's opt-in.
   *
   * Deliberately one `and(...)`: the admin settings page adds its per-admin
   * opt-out as one more clause here, and nowhere else.
   */
  static async listAdminsWithPhone(): Promise<
    { id: string; phoneNumber: string }[]
  > {
    // The cast is what `isNotNull` above already guarantees — drizzle types the
    // column from the schema, not from the predicate. Deliberately the ONLY
    // filter: a second one in JS would mean the `where` could be dropped
    // without a single test noticing.
    return (await db
      .select({ id: users.id, phoneNumber: users.phoneNumber })
      .from(users)
      .where(and(eq(users.role, ROLES.ADMIN), isNotNull(users.phoneNumber)))
      .orderBy(asc(users.createdAt))) as { id: string; phoneNumber: string }[];
  }

  /**
   * Holds this user's row until `tx` ends — checkout's one-at-a-time lock per
   * account (`src/logic/checkout/create-order.ts`). A second checkout by the
   * same account waits here until the first has committed, so the caps it
   * counts next include that order.
   *
   * `FOR NO KEY UPDATE`, not `FOR UPDATE`: two checkouts still conflict, but
   * the `FOR KEY SHARE` a foreign-key check takes on this row does not, so an
   * insert that references the user (a login's session row) never waits for a
   * checkout to finish.
   *
   * It must be the transaction's FIRST lock. Product rows are only ever locked
   * after it, in `byProductId` order, so no two transactions can hold these in
   * opposite orders and deadlock.
   */
  static async lockForCheckout(tx: Tx, id: string): Promise<void> {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .for('no key update');
  }

  /** Creates a customer unless an elevated role is asked for explicitly. */
  static async create(input: {
    email: string;
    name: string;
    role?: Role;
    phoneNumber?: string;
    phoneNumberVerified?: boolean;
  }): Promise<User> {
    const [row] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: input.email.toLowerCase(),
        name: input.name,
        emailVerified: true,
        role: input.role ?? ROLES.CUSTOMER,
        phoneNumber: input.phoneNumber,
        phoneNumberVerified: input.phoneNumberVerified ?? false,
      })
      .returning();
    return row;
  }

  /**
   * Changes one user's role. Only `pnpm create-admin` calls this — there is no
   * API path to it, and there must not be one: a role is granted off-line, by
   * someone with a shell, never by anything a request can reach.
   */
  static async setRole(id: string, role: Role): Promise<User> {
    const [row] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning();
    return row;
  }
}
