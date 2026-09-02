// All Drizzle DB access goes through DAOs like this one. This one owns both the
// `provinces` and `shipping_rates` tables: they are 1:1 and always read and
// written together (a province exists to carry a fee), so a single DAO returning
// the joined `{ provinceId, name, fee }` is the shape every caller wants — the
// checkout fee preview, the province <select>, and the admin rate editor.
// Never write raw SQL.
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { provinces, shippingRates } from '@/db/schema/shipping';

/** A province and its current fee, the joined shape the API serves. */
export type ShippingRateRow = { provinceId: number; name: string; fee: number };

const rateColumns = {
  provinceId: provinces.id,
  name: provinces.name,
  fee: shippingRates.fee,
};

export class ShippingRateDao {
  /**
   * Insert-or-update a province by name and ensure it has a rate. The seed
   * relies on this to stay idempotent: the province upserts on its unique name,
   * and the rate is inserted only if missing (`onConflictDoNothing`) — so a
   * re-seed never resets a fee an admin has tuned through `updateFee`. Returns
   * the resulting joined row.
   */
  static async upsertProvinceWithRate(input: {
    name: string;
    fee: number;
  }): Promise<ShippingRateRow> {
    return db.transaction(async (tx) => {
      const [province] = await tx
        .insert(provinces)
        .values({ name: input.name })
        // Update name to itself so the row (and its id) always comes back,
        // whether it was just inserted or already existed.
        .onConflictDoUpdate({
          target: provinces.name,
          set: { name: input.name },
        })
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
   * Every province with its fee, for the checkout province <select>. Ordered by
   * ascending id — the seed insertion order, which is the intended UX order
   * (Tehran first). Not by name: Postgres Persian collation is unreliable.
   */
  static async list(): Promise<ShippingRateRow[]> {
    return db
      .select(rateColumns)
      .from(provinces)
      .innerJoin(shippingRates, eq(shippingRates.provinceId, provinces.id))
      .orderBy(asc(provinces.id));
  }

  /** One province's rate by id, or `null` when no such province exists. */
  static async getByProvinceId(
    provinceId: number,
  ): Promise<ShippingRateRow | null> {
    const [row] = await db
      .select(rateColumns)
      .from(provinces)
      .innerJoin(shippingRates, eq(shippingRates.provinceId, provinces.id))
      .where(eq(provinces.id, provinceId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Admin rate update: set a province's fee. Returns the updated joined row, or
   * `null` when the province has no rate to update (an unknown province) — which
   * the admin route turns into its "unknown province" answer. A negative fee is
   * refused by the `shipping_rates_fee_non_negative` CHECK, not silently stored.
   */
  static async updateFee(
    provinceId: number,
    fee: number,
  ): Promise<ShippingRateRow | null> {
    const [updated] = await db
      .update(shippingRates)
      .set({ fee })
      .where(eq(shippingRates.provinceId, provinceId))
      .returning({ provinceId: shippingRates.provinceId });
    if (!updated) return null;
    return ShippingRateDao.getByProvinceId(provinceId);
  }
}
