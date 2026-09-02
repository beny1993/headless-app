// Writes the 31 provinces and their placeholder rates (./shipping-data.ts)
// through the DAO. Run it with `pnpm seed-shipping`.
//
// Re-running is safe: each province upserts by name and its rate is inserted
// only if missing, so a re-seed never resets a fee an admin tuned through the
// rate-update endpoint (see ShippingRateDao.upsertProvinceWithRate).
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';

export const seedShipping = async (): Promise<{ provinces: number }> => {
  for (const province of SEED_PROVINCES) {
    await ShippingRateDao.upsertProvinceWithRate(province);
  }
  return { provinces: SEED_PROVINCES.length };
};
