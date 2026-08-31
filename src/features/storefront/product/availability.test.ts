import { describe, expect, it } from 'vitest';
import {
  LOW_STOCK_THRESHOLD,
  availability,
  isPurchasable,
  AVAILABILITY,
} from './availability';

describe('availability', () => {
  it('reads a stocked product as available', () => {
    expect(availability(24)).toBe(AVAILABILITY.IN_STOCK);
  });

  it('reads zero stock as out of stock', () => {
    expect(availability(0)).toBe(AVAILABILITY.OUT_OF_STOCK);
  });

  it('warns while stock is at or below the low threshold', () => {
    expect(availability(LOW_STOCK_THRESHOLD)).toBe(AVAILABILITY.LOW_STOCK);
    expect(availability(1)).toBe(AVAILABILITY.LOW_STOCK);
  });

  it('stops warning one unit above the threshold', () => {
    expect(availability(LOW_STOCK_THRESHOLD + 1)).toBe(AVAILABILITY.IN_STOCK);
  });

  // The column has a `stock >= 0` CHECK, so a negative can only arrive from a
  // caller bug — and "less than nothing" must never read as buyable.
  it('treats a negative count as out of stock, not as low stock', () => {
    expect(availability(-1)).toBe(AVAILABILITY.OUT_OF_STOCK);
  });

  it('treats a non-finite count as out of stock', () => {
    expect(availability(Number.NaN)).toBe(AVAILABILITY.OUT_OF_STOCK);
  });

  it('handles an enormous count as plain availability', () => {
    expect(availability(Number.MAX_SAFE_INTEGER)).toBe(AVAILABILITY.IN_STOCK);
  });
});

describe('isPurchasable', () => {
  it('allows adding a stocked product to the cart', () => {
    expect(isPurchasable(24)).toBe(true);
    expect(isPurchasable(1)).toBe(true);
  });

  // The story's acceptance criterion: add is disabled when stock is zero.
  it('refuses a product with no stock', () => {
    expect(isPurchasable(0)).toBe(false);
  });

  it('refuses a negative or non-finite count', () => {
    expect(isPurchasable(-3)).toBe(false);
    expect(isPurchasable(Number.NaN)).toBe(false);
  });
});
