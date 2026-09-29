// All Drizzle DB access goes through DAOs like this one. This one owns both the
// `provinces` and `shipping_rates` tables: they are 1:1 and always read and
// written together (a province exists to carry a fee), so a single DAO returning
// the joined `{ provinceId, name, fee }` is the shape every caller wants — the
// checkout fee preview, the province <select>, and the admin rate editor.
// Never write raw SQL.
//
// The read split is the soft delete: storefront reads (`listActive`,
// `getByProvinceId`) see only active provinces, so a deactivated one is neither
// offered nor priced; admin reads (`list`, `getByProvinceIdForAdmin`,
// `findByName`) see every province with its `isActive` flag. Every write stores
// the name through `normalizeProvinceName`, so the unique constraint on
// `provinces.name` is the real duplicate backstop.
import { and, asc, eq } from 'drizzle-orm';
import { db, type Executor } from '@/db';

import { provinces, shippingRates } from '@/db/schema/shipping';
import { normalizeProvinceName } from '@/lib/shipping/province-input';

/** A province and its current fee, the joined shape the storefront API serves. */
type ShippingRateRow = { provinceId: number; name: string; fee: number };

/** The admin view: the storefront row plus whether the province is active. */
export type AdminProvinceRow = ShippingRateRow & { isActive: boolean };

const rateColumns = {
  provinceId: provinces.id,
  name: provinces.name,
  fee: shippingRates.fee,
};

const adminColumns = { ...rateColumns, isActive: provinces.isActive };

const hasRate = eq(shippingRates.provinceId, provinces.id);

/** Every province joined to its rate (1:1, so an inner join loses nothing). */
const selectRates = () =>
  db.select(rateColumns).from(provinces).innerJoin(shippingRates, hasRate);
const selectAdminRows = (on: Executor = db) =>
  on.select(adminColumns).from(provinces).innerJoin(shippingRates, hasRate);

export class ShippingRateDao {
  /**
   * Insert-or-update a province by name and ensure it has a rate. The seed
   * relies on this to stay idempotent: the province upserts on its unique name,
   * and the rate is inserted only if missing (`onConflictDoNothing`) — so a
   * re-seed never resets a fee an admin has tuned through `updateFee`. Returns
   * the resulting joined row.
   *
   * The conflict set is `{ name }` ONLY, and that is load-bearing: it leaves
   * `is_active` alone, so a re-seed never reactivates a province the admin
   * deactivated (pinned in the integration test).
   */
  static async upsertProvinceWithRate(input: {
    name: string;
    fee: number;
  }): Promise<ShippingRateRow> {
    const name = normalizeProvinceName(input.name);
    return db.transaction(async (tx) => {
      const [province] = await tx
        .insert(provinces)
        .values({ name })
        // Update name to itself so the row (and its id) always comes back,
        // whether it was just inserted or already existed.
        .onConflictDoUpdate({ target: provinces.name, set: { name } })
        .returning({ id: provinces.id, name: provinces.name });

      await tx
        .insert(shippingRates)
        .values({ provinceId: province.id, fee: input.fee })
        .onConflictDoNothing({ target: shippingRates.provinceId });

      const [rate] = await tx
        .select({ fee: shippingRates.fee })
        .from(shippingRates)
        .where(eq(shippingRates.provinceId, province.id));

      return { provinceId: province.id, name: province.name, fee: rate.fee };
    });
  }

  /**
   * Admin create: a new province and its rate in one transaction. Returns `null`
   * when the (normalized) name is already taken — active or not — and then the
   * rate is never inserted. The insert itself decides the race
   * (`onConflictDoNothing`), so there is no check-then-insert window. Unlike
   * `upsertProvinceWithRate`, it never touches an existing row.
   */
  static async create(input: {
    name: string;
    fee: number;
  }): Promise<AdminProvinceRow | null> {
    return db.transaction(async (tx) => {
      const [province] = await tx
        .insert(provinces)
        .values({ name: normalizeProvinceName(input.name) })
        .onConflictDoNothing({ target: provinces.name })
        .returning({
          provinceId: provinces.id,
          name: provinces.name,
          isActive: provinces.isActive,
        });
      if (!province) return null;

      const [rate] = await tx
        .insert(shippingRates)
        .values({ provinceId: province.provinceId, fee: input.fee })
        .returning({ fee: shippingRates.fee });

      return { ...province, fee: rate.fee };
    });
  }

  /**
   * Every province with its fee and flag, for the admin rate editor. Ordered by
   * ascending id — the seed insertion order, which is the intended UX order
   * (Tehran first), and a new province simply appends. Not by name: Postgres
   * Persian collation is unreliable.
   */
  static async list(executor: Executor = db): Promise<AdminProvinceRow[]> {
    return selectAdminRows(executor).orderBy(asc(provinces.id));
  }

  /** The active provinces with their fees, id order — the storefront selects and public list. */
  static async listActive(): Promise<ShippingRateRow[]> {
    return selectRates()
      .where(eq(provinces.isActive, true))
      .orderBy(asc(provinces.id));
  }

  /**
   * One active province's rate by id, or `null` when it is unknown OR inactive —
   * so checkout refuses (422) and the fee preview rejects (400) a deactivated
   * province, and an address cannot be saved against one.
   */
  static async getByProvinceId(
    provinceId: number,
  ): Promise<ShippingRateRow | null> {
    const [row] = await selectRates()
      .where(and(eq(provinces.id, provinceId), eq(provinces.isActive, true)))
      .limit(1);
    return row ?? null;
  }

  /** One province by id, active or not, with its flag — or `null` when unknown. */
  static async getByProvinceIdForAdmin(
    provinceId: number,
  ): Promise<AdminProvinceRow | null> {
    const [row] = await selectAdminRows()
      .where(eq(provinces.id, provinceId))
      .limit(1);
    return row ?? null;
  }

  /** A province by name (normalized first), active or not — the duplicate classifier. */
  static async findByName(name: string): Promise<AdminProvinceRow | null> {
    const [row] = await selectAdminRows()
      .where(eq(provinces.name, normalizeProvinceName(name)))
      .limit(1);
    return row ?? null;
  }

  /** Deactivate or reactivate a province. `null` when no such province exists. */
  static async setActive(
    provinceId: number,
    isActive: boolean,
  ): Promise<AdminProvinceRow | null> {
    const [updated] = await db
      .update(provinces)
      .set({ isActive })
      .where(eq(provinces.id, provinceId))
      .returning({ id: provinces.id });
    if (!updated) return null;
    return ShippingRateDao.getByProvinceIdForAdmin(provinceId);
  }

  /**
   * Admin rate update: set a province's fee. Returns the updated admin row, or
   * `null` when the province has no rate to update (an unknown province) — which
   * the admin route turns into its "unknown province" answer. A negative fee is
   * refused by the `shipping_rates_fee_non_negative` CHECK, not silently stored.
   * Re-reads through the unfiltered admin lookup, so an inactive province's fee
   * stays editable.
   */
  static async updateFee(
    provinceId: number,
    fee: number,
  ): Promise<AdminProvinceRow | null> {
    const [updated] = await db
      .update(shippingRates)
      .set({ fee })
      .where(eq(shippingRates.provinceId, provinceId))
      .returning({ provinceId: shippingRates.provinceId });
    if (!updated) return null;
    return ShippingRateDao.getByProvinceIdForAdmin(provinceId);
  }

  /**
   * Admin bulk update: set EVERY province's fee — inactive ones too, since the
   * editor lists and edits them all — and return the admin list. One `UPDATE`
   * with no `WHERE`, deliberately: a single statement is atomic, so the fees
   * never sit half-changed the way 31 per-row writes could, and a negative fee
   * is refused for all of them by the `shipping_rates_fee_non_negative` CHECK.
   * `executor` lets the integration test run it inside a transaction it rolls
   * back, because this is the one write that touches the seeded rows.
   */
  static async setAllFees(
    fee: number,
    executor: Executor = db,
  ): Promise<AdminProvinceRow[]> {
    await executor.update(shippingRates).set({ fee });
    return ShippingRateDao.list(executor);
  }
}
