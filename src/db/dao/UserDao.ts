// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ROLES, users, type Role, type User } from '@/db/schema/auth';

export class UserDao {
  static async findByEmail(email: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  static async list(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.createdAt));
  }

  /** Creates a customer unless an elevated role is asked for explicitly. */
  static async create(input: {
    email: string;
    name: string;
    role?: Role;
  }): Promise<User> {
    const [row] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: input.email.toLowerCase(),
        name: input.name,
        emailVerified: true,
        role: input.role ?? ROLES.CUSTOMER,
      })
      .returning();
    return row;
  }
}
