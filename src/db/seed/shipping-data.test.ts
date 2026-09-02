// No database needed: these check the seed data itself, so they run everywhere.
import { describe, expect, it } from 'vitest';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';

describe('shipping seed data', () => {
  it('carries all 31 Iranian provinces', () => {
    expect(SEED_PROVINCES).toHaveLength(31);
  });

  it('has a unique name for every province', () => {
    expect(new Set(SEED_PROVINCES.map((p) => p.name)).size).toBe(
      SEED_PROVINCES.length,
    );
  });

  it('prices every province in whole non-negative Toman', () => {
    // Integer Toman, and fee >= 0 (free shipping is valid) — the same rule the
    // CHECK constraint enforces, caught here before anything touches a database.
    for (const province of SEED_PROVINCES) {
      expect(Number.isSafeInteger(province.fee)).toBe(true);
      expect(province.fee).toBeGreaterThanOrEqual(0);
    }
  });

  it('names the provinces the checkout and admin screens expect, Tehran first', () => {
    // Insertion order is the identity order and the UX order the prototype uses
    // (Tehran the cheapest/first). A spot-check of the corners keeps the Persian
    // names honest against the design reference.
    expect(SEED_PROVINCES[0].name).toBe('تهران');
    expect(SEED_PROVINCES.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'اصفهان',
        'فارس',
        'خراسان رضوی',
        'آذربایجان شرقی',
        'سیستان و بلوچستان',
      ]),
    );
  });
});
