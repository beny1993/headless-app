// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
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
