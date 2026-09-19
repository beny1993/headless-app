// All Drizzle DB access goes through DAOs like this one. Multi-DAO orchestration
// (the discount claim joins checkout's stock-decrement transaction) lives in
// src/logic/checkout, which composes these methods. Never write raw SQL — the
// atomic claim below is the query builder, not a string.
//
// This DAO owns the canonical form of a code: `create` and `findByCode` both run
// the raw input through `normalizeCode`, so a code stored as `WELCOME10` is found
// whether the shopper types `welcome10` or `  Welcome10 `. `usage_count` is moved
// ONLY by `claim` (never by `create`/`setActive`), which is why the admin input
// type omits it — the checkout claim is the single writer of that column.
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type Executor, type Tx } from '@/db';

import {
  discountCodes,
  type DiscountCode,
  type NewDiscountCode,
} from '@/db/schema/discounts';
import { normalizeCode } from '@/lib/discount/discount-code';

/**
 * What a caller supplies to create a code. The database owns `id` and both
 * timestamps; `usage_count` is owned by the atomic claim, so it is absent here —
 * an admin body that carried one could not raise the limit or pre-exhaust a code.
 */
export type DiscountCodeInput = Omit<
  NewDiscountCode,
  'id' | 'usageCount' | 'createdAt' | 'updatedAt'
>;

export class DiscountCodeDao {
  /**
   * Inserts a code, normalizing it to its canonical (trimmed + upper-cased) form
   * last so a caller reaching past `DiscountCodeInput` cannot supply a
   * non-canonical `code` that would then never be found by `findByCode`.
   */
  static async create(input: DiscountCodeInput): Promise<DiscountCode> {
    const [row] = await db
      .insert(discountCodes)
      .values({ ...input, code: normalizeCode(input.code) })
      .returning();
    return row;
  }

  /**
   * One code by its (canonicalized) text, or `null`. Takes an `Executor` so
   * checkout can read it inside its transaction — the classification read that
   * turns an unknown/inactive/expired/below-minimum code into a specific Persian
   * error, distinct from the authoritative `claim` that follows.
   */
  static async findByCode(
    executor: Executor,
    code: string,
  ): Promise<DiscountCode | null> {
    const [row] = await executor
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.code, normalizeCode(code)))
      .limit(1);
    return row ?? null;
  }

  /**
   * The usage-limit guard, as one atomic statement — the twin of
   * `ProductDao.decrementStock`:
   *
   *   UPDATE discount_codes SET usage_count = usage_count + 1
   *   WHERE id = ? AND is_active
   *     AND (usage_limit IS NULL OR usage_count < usage_limit)
   *     AND (expires_at IS NULL OR expires_at > now())
   *   RETURNING *
   *
   * Two checkouts racing for the last remaining use cannot both win: Postgres
   * serializes the row's UPDATE and re-checks `usage_count < usage_limit` against
   * the committed row, not a stale read, so once the limit is reached the next
   * claim matches no row and returns `null`. Expiry is checked with the DB's own
   * `now()` (not a JS clock), so the boundary is authoritative. `is_active` is in
   * the guard too, so a code deactivated mid-flight stops claiming.
   *
   * Runs inside checkout's transaction (`Tx`, never the bare pool): a later
   * failure there — an oversell, an idempotency collision — rolls this claim back
   * with the aborted transaction, so a use is charged only for an order that
   * actually commits. Returns the updated row (compute the discount from it, like
   * the oversell snapshot), or `null` when the code could not be claimed.
   */
  static async claim(tx: Tx, id: string): Promise<DiscountCode | null> {
    const [row] = await tx
      .update(discountCodes)
      .set({ usageCount: sql`${discountCodes.usageCount} + 1` })
      .where(
        and(
          eq(discountCodes.id, id),
          eq(discountCodes.isActive, true),
          or(
            isNull(discountCodes.usageLimit),
            lt(discountCodes.usageCount, discountCodes.usageLimit),
          ),
          or(
            isNull(discountCodes.expiresAt),
            gt(discountCodes.expiresAt, sql`now()`),
          ),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Activate or deactivate a code — the admin panel's "delete" (codes are
   * order-snapshotted by amount + string, so they are never hard-deleted, only
   * switched off). Returns the updated row, or `null` for an unknown id.
   */
  static async setActive(
    id: string,
    isActive: boolean,
  ): Promise<DiscountCode | null> {
    const [row] = await db
      .update(discountCodes)
      .set({ isActive })
      .where(eq(discountCodes.id, id))
      .returning();
    return row ?? null;
  }

  /** Every code, newest first — the admin panel list (active and inactive). */
  static async listForAdmin(): Promise<DiscountCode[]> {
    return db
      .select()
      .from(discountCodes)
      .orderBy(desc(discountCodes.createdAt));
  }
}
