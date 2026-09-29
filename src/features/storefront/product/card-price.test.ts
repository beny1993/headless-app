import { describe, expect, it } from 'vitest';
import { cardPrice } from './card-price';

const standalone = {
  price: 185_000,
  oldPrice: 210_000,
  stock: 4,
  familyMinPrice: 185_000,
  familyPricesVary: false,
  familyInStock: true,
};

describe('cardPrice', () => {
  it('prints a standalone product’s own price and its «was»', () => {
    expect(cardPrice(standalone)).toEqual({
      price: 185_000,
      oldPrice: 210_000,
    });
  });

  it('prints the buyable price, not a sold-out head’s, when one price is left', () => {
    // A sold-out head at 139,000 with one smell in stock at 149,000: the
    // family's prices no longer vary, and the number is the smell's.
    expect(
      cardPrice({
        ...standalone,
        price: 139_000,
        stock: 0,
        familyMinPrice: 149_000,
      }),
    ).toEqual({ price: 149_000, oldPrice: null });
  });

  it('keeps the «was» off a sold-out head even when the price matches it', () => {
    expect(
      cardPrice({ ...standalone, stock: 0, familyMinPrice: 185_000 }).oldPrice,
    ).toBeNull();
  });

  it('never claims a «was» under «از …»', () => {
    expect(
      cardPrice({
        ...standalone,
        familyMinPrice: 149_000,
        familyPricesVary: true,
      }),
    ).toEqual({ price: 149_000, oldPrice: null });
  });

  it('keeps the head’s «was» on a family with nothing in stock, priced as one', () => {
    // Nothing to buy, so every member is priced and the head's price is the
    // one printed; the card's «ناموجود» badge says the rest.
    expect(
      cardPrice({ ...standalone, stock: 0, familyInStock: false }),
    ).toEqual({ price: 185_000, oldPrice: 210_000 });
  });
});
