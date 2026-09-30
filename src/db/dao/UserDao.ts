// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL:
// the admin reads' per-user scalars below are parameterized `sql` fragments over
// the schema's own identifiers, like `OrderDao`'s `hasPaidPayment`.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  like,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db, type Tx } from '@/db';
import { escapeLike } from '@/db/dao/like-pattern';
import { isRevenueOrder } from '@/db/dao/OrderDao';
import { ROLES, users, type Role, type User } from '@/db/schema/auth';
import { orders } from '@/db/schema/orders';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { classifyUserSearch } from '@/lib/users/user-search';

/**
 * One user as the admin users list and detail show them. An explicit
 * projection: the `email` column (a fake `…@phone.smokey.invalid`) and every
 * Better Auth session or account field are never selected, so they cannot
 * reach a page.
 */
export type AdminUserRow = {
  id: string;
  name: string;
  /** Canonical `+989…`, or null for a row with no number attached. */
  phoneNumber: string | null;
  role: string;
  createdAt: Date;
  /** Every order the user placed, in any status. */
  orderCount: number;
  /** Integer Toman over the dashboard's revenue rule (`isRevenueOrder`). */
  totalSpent: number;
};

// **The correlated reference to the outer user goes through a nested `sql`
// fragment, never straight into a select field's own template.** This query
// reads one table, so drizzle renders a column that sits directly in a select
// field unqualified: `"user_id" = "id"` inside `from orders` binds both sides
// to `orders` (here a `text = uuid` error; with matching types it would be a
// silently wrong count). A nested fragment is rendered qualified. The same
// trap, and its warning, live beside `FAMILY_SCOPE` in ./product-sql.ts.
const OWN_ORDERS = sql`from ${orders} where ${orders.userId} = ${users.id}`;
const ORDER_COUNT = sql`select count(*) ${OWN_ORDERS}`;
const TOTAL_SPENT = sql`select coalesce(sum(${orders.total}), 0) ${OWN_ORDERS} and ${isRevenueOrder()}`;

const ADMIN_USER_FIELDS = {
  id: users.id,
  name: users.name,
  phoneNumber: users.phoneNumber,
  role: users.role,
  createdAt: users.createdAt,
  orderCount: sql<number>`(${ORDER_COUNT})`.mapWith(Number),
  // `sum` of a `bigint` arrives as a numeric string. `Number` is exact: one
  // customer's lifetime spend stays far below 2^53 Toman.
  totalSpent: sql<number>`(${TOTAL_SPENT})`.mapWith(Number),
};

/** The list's `where` for one search term (see `classifyUserSearch`). */
function searchWhere(search: string | undefined): SQL | undefined {
  if (!search) return undefined;
  const match = classifyUserSearch(search);
  switch (match.by) {
    case 'phone':
      return eq(users.phoneNumber, match.phone);
    case 'phonePrefix':
      // Digits only after the `+98`, so nothing in it is a wildcard.
      return like(users.phoneNumber, `${match.prefix}%`);
    case 'name':
      return ilike(users.name, `%${escapeLike(match.text)}%`);
  }
}

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

  /**
   * One page of the admin users list: every account, admins and customers
   * alike, newest first, optionally narrowed by one search term, plus the size
   * of that whole set for the pager. Not owner-scoped by design; the page's
   * `requireAdmin` is what authorizes it.
   */
  static async pageForAdmin({
    search,
    page = 1,
    limit = ADMIN_PAGE_SIZE,
  }: {
    search?: string;
    /** One-based. */
    page?: number;
    limit?: number;
  } = {}): Promise<{ items: AdminUserRow[]; total: number }> {
    const where = searchWhere(search);
    const pageQuery = db
      .select(ADMIN_USER_FIELDS)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const [items, total] = await Promise.all([
      pageQuery,
      db.$count(users, where),
    ]);
    return { items, total };
  }

  /** One user for the admin detail page, in the list's projection, or null. */
  static async findForAdmin(id: string): Promise<AdminUserRow | null> {
    const [row] = await db
      .select(ADMIN_USER_FIELDS)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * How many customers there are, or how many joined at or after `since`. Only
   * `role = customer`: admins are made by `pnpm create-admin` and do not «join».
   * The users page and the dashboard both pass `jalaliMonthStart(now)` for
   * «مشتریان جدید این ماه», so the two show one number.
   */
  static async countCustomers(since?: Date): Promise<number> {
    return db.$count(
      users,
      and(eq(users.role, ROLES.CUSTOMER), since && gte(users.createdAt, since)),
    );
  }
}
