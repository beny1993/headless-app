import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CART_STORAGE_KEY,
  MAX_LINE_QTY,
  addLine,
  cartCount,
  cartTotal,
  lineTotal,
  parseCart,
  removeLine,
  setQty,
  type CartLine,
  type CartLineInput,
} from './cart';

// A realistic line: Persian title, integer Toman, storage key rather than URL —
// the shape `seedCatalog` produces.
const DRY_FOOD: CartLineInput = {
  productId: '11111111-1111-4111-8111-111111111111',
  slug: 'cat-dry-food',
  title: 'غذای خشک گربه بالغ',
  sku: 'SKU-CAT-DRY-01',
  brand: 'رویال کنین',
  unitPrice: 2_450_000,
  imageKey: 'products/cat-dry-food.jpg',
};

const TOY: CartLineInput = {
  productId: '22222222-2222-4222-8222-222222222222',
  slug: 'cat-toy',
  title: 'اسباب‌بازی موش‌کاتنیپ',
  sku: 'SKU-CAT-TOY-01',
  unitPrice: 185_000,
};

const line = (input: CartLineInput, qty: number): CartLine => ({ ...input, qty });

describe('parseCart', () => {
  it('reads back a cart written by a previous session', () => {
    const stored = JSON.stringify([line(DRY_FOOD, 2)]);

    expect(parseCart(stored)).toEqual([line(DRY_FOOD, 2)]);
  });

  it('returns an empty cart when nothing is stored', () => {
    expect(parseCart(null)).toEqual([]);
  });

  it('returns an empty cart when the stored value is not JSON', () => {
    expect(parseCart('{ this is not json')).toEqual([]);
  });

  it('returns an empty cart when the stored JSON is not an array', () => {
    expect(parseCart('{"productId":"x"}')).toEqual([]);
  });

  it('drops lines missing a required field', () => {
    const stored = JSON.stringify([
      { ...DRY_FOOD, qty: 1, sku: undefined },
      line(TOY, 1),
    ]);

    expect(parseCart(stored)).toEqual([line(TOY, 1)]);
  });

  it('drops lines whose price is not a positive integer Toman', () => {
    const stored = JSON.stringify([
      { ...DRY_FOOD, unitPrice: 1999.5, qty: 1 },
      { ...TOY, unitPrice: 0, qty: 1 },
      { ...TOY, productId: 'other', unitPrice: -500, qty: 1 },
    ]);

    expect(parseCart(stored)).toEqual([]);
  });

  it('drops lines whose price exceeds the safe integer range', () => {
    const stored = JSON.stringify([
      { ...DRY_FOOD, unitPrice: Number.MAX_SAFE_INTEGER + 2, qty: 1 },
    ]);

    expect(parseCart(stored)).toEqual([]);
  });

  it('drops lines with a quantity below one', () => {
    const stored = JSON.stringify([line(DRY_FOOD, 0), line(TOY, -3)]);

    expect(parseCart(stored)).toEqual([]);
  });

  it('clamps a stored quantity above the cap', () => {
    const stored = JSON.stringify([line(DRY_FOOD, 5000)]);

    expect(parseCart(stored)).toEqual([line(DRY_FOOD, MAX_LINE_QTY)]);
  });

  it('keeps the optional brand and image key when present', () => {
    const parsed = parseCart(JSON.stringify([line(DRY_FOOD, 1)]));

    expect(parsed[0]?.brand).toBe('رویال کنین');
    expect(parsed[0]?.imageKey).toBe('products/cat-dry-food.jpg');
  });

  it('keeps a line that has no brand or image', () => {
    expect(parseCart(JSON.stringify([line(TOY, 1)]))).toEqual([line(TOY, 1)]);
  });
});

describe('addLine', () => {
  it('adds a single unit by default', () => {
    expect(addLine([], DRY_FOOD)).toEqual([line(DRY_FOOD, 1)]);
  });

  it('adds an explicit quantity', () => {
    expect(addLine([], DRY_FOOD, 3)).toEqual([line(DRY_FOOD, 3)]);
  });

  it('increments the existing line instead of duplicating the product', () => {
    const lines = addLine([line(DRY_FOOD, 2)], DRY_FOOD, 3);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.qty).toBe(5);
  });

  it('keeps the snapshot taken at first add when the product is re-added', () => {
    const cheaper = { ...DRY_FOOD, unitPrice: 1_000_000, title: 'عنوان تازه' };

    const lines = addLine([line(DRY_FOOD, 1)], cheaper);

    expect(lines[0]?.unitPrice).toBe(DRY_FOOD.unitPrice);
    expect(lines[0]?.title).toBe(DRY_FOOD.title);
  });

  it('caps the incremented quantity at the maximum', () => {
    const lines = addLine([line(DRY_FOOD, MAX_LINE_QTY - 1)], DRY_FOOD, 50);

    expect(lines[0]?.qty).toBe(MAX_LINE_QTY);
  });

  it('caps a first add above the maximum', () => {
    expect(addLine([], DRY_FOOD, 5000)[0]?.qty).toBe(MAX_LINE_QTY);
  });

  it('ignores a non-positive quantity', () => {
    expect(addLine([], DRY_FOOD, 0)).toEqual([]);
    expect(addLine([line(TOY, 1)], DRY_FOOD, -2)).toEqual([line(TOY, 1)]);
  });

  it('appends after the products already in the cart', () => {
    const lines = addLine([line(DRY_FOOD, 1)], TOY);

    expect(lines.map((l) => l.slug)).toEqual(['cat-dry-food', 'cat-toy']);
  });

  it('does not mutate the cart it was given', () => {
    const before = [line(DRY_FOOD, 1)];

    addLine(before, DRY_FOOD, 4);

    expect(before[0]?.qty).toBe(1);
  });
});

describe('setQty', () => {
  it('sets the quantity of the matching line', () => {
    const lines = setQty([line(DRY_FOOD, 1), line(TOY, 1)], DRY_FOOD.productId, 4);

    expect(lines[0]?.qty).toBe(4);
    expect(lines[1]?.qty).toBe(1);
  });

  it('removes the line when the quantity drops to zero', () => {
    const lines = setQty([line(DRY_FOOD, 1), line(TOY, 2)], DRY_FOOD.productId, 0);

    expect(lines).toEqual([line(TOY, 2)]);
  });

  it('removes the line for a negative quantity', () => {
    expect(setQty([line(DRY_FOOD, 3)], DRY_FOOD.productId, -1)).toEqual([]);
  });

  it('caps the quantity at the maximum', () => {
    expect(setQty([line(DRY_FOOD, 1)], DRY_FOOD.productId, 1000)[0]?.qty).toBe(
      MAX_LINE_QTY,
    );
  });

  it('truncates a fractional quantity', () => {
    expect(setQty([line(DRY_FOOD, 1)], DRY_FOOD.productId, 2.9)[0]?.qty).toBe(2);
  });

  it('leaves the cart untouched for an unknown product', () => {
    const before = [line(DRY_FOOD, 1)];

    expect(setQty(before, 'no-such-product', 5)).toEqual(before);
  });

  it('does not mutate the cart it was given', () => {
    const before = [line(DRY_FOOD, 1)];

    setQty(before, DRY_FOOD.productId, 7);

    expect(before[0]?.qty).toBe(1);
  });
});

describe('removeLine', () => {
  it('removes only the matching product', () => {
    const lines = removeLine([line(DRY_FOOD, 1), line(TOY, 2)], TOY.productId);

    expect(lines).toEqual([line(DRY_FOOD, 1)]);
  });

  it('is a no-op for an unknown product', () => {
    const before = [line(DRY_FOOD, 1)];

    expect(removeLine(before, 'no-such-product')).toEqual(before);
  });

  it('empties a single-line cart', () => {
    expect(removeLine([line(DRY_FOOD, 1)], DRY_FOOD.productId)).toEqual([]);
  });
});

describe('cartCount', () => {
  it('counts units, not lines', () => {
    expect(cartCount([line(DRY_FOOD, 3), line(TOY, 2)])).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(cartCount([])).toBe(0);
  });
});

describe('cartTotal', () => {
  it('is zero for an empty cart', () => {
    expect(cartTotal([])).toBe(0n);
  });

  it('sums price times quantity across lines', () => {
    expect(cartTotal([line(DRY_FOOD, 2), line(TOY, 3)])).toBe(
      BigInt(2_450_000 * 2 + 185_000 * 3),
    );
  });

  it('stays exact above the safe integer range', () => {
    const huge = { ...DRY_FOOD, unitPrice: Number.MAX_SAFE_INTEGER };

    expect(cartTotal([line(huge, MAX_LINE_QTY)])).toBe(
      BigInt(Number.MAX_SAFE_INTEGER) * BigInt(MAX_LINE_QTY),
    );
  });

  it('gives a single line its own total', () => {
    expect(lineTotal(line(DRY_FOOD, 4))).toBe(9_800_000n);
  });
});

// The storage-backed store. Each test loads a fresh module instance, which is
// also how a page reload behaves: nothing in memory, everything from storage.
async function freshCart() {
  vi.resetModules();
  return import('./cart');
}

// What a second tab actually does: it writes the shared storage, and the
// browser delivers a `storage` event to every *other* tab. Dispatching the
// event without the write would test a browser that does not exist.
function writeFromAnotherTab(newValue: string) {
  localStorage.setItem(CART_STORAGE_KEY, newValue);
  window.dispatchEvent(
    new StorageEvent('storage', { key: CART_STORAGE_KEY, newValue }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the stored cart', () => {
  it('starts empty when storage holds nothing', async () => {
    const cart = await freshCart();

    expect(cart.getCart()).toEqual([]);
  });

  it('survives a reload', async () => {
    const first = await freshCart();
    first.addToCart(DRY_FOOD, 2);

    const afterReload = await freshCart();

    expect(afterReload.getCart()).toEqual([line(DRY_FOOD, 2)]);
  });

  it('persists a quantity change', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);

    cart.setLineQty(DRY_FOOD.productId, 6);

    expect((await freshCart()).getCart()[0]?.qty).toBe(6);
  });

  it('persists a removal', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);
    cart.addToCart(TOY);

    cart.removeFromCart(DRY_FOOD.productId);

    expect((await freshCart()).getCart()).toEqual([line(TOY, 1)]);
  });

  it('persists a clear', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);

    cart.clearCart();

    expect((await freshCart()).getCart()).toEqual([]);
  });

  it('recovers from a corrupt stored cart', async () => {
    localStorage.setItem(CART_STORAGE_KEY, 'not json at all');
    const cart = await freshCart();

    expect(cart.getCart()).toEqual([]);

    cart.addToCart(TOY);
    expect(cart.getCart()).toEqual([line(TOY, 1)]);
  });

  it('returns the same array reference until something changes', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);

    expect(cart.getCart()).toBe(cart.getCart());
  });

  it('returns a new array reference after a change', async () => {
    const cart = await freshCart();
    const before = cart.getCart();

    cart.addToCart(DRY_FOOD);

    expect(cart.getCart()).not.toBe(before);
  });

  it('keeps working when storage refuses to write', async () => {
    const cart = await freshCart();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const notified = vi.fn();
    const unsubscribe = cart.subscribe(notified);

    cart.addToCart(DRY_FOOD);

    expect(cart.getCart()).toEqual([line(DRY_FOOD, 1)]);
    expect(notified).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('cart subscribers', () => {
  it('are notified when the cart changes', async () => {
    const cart = await freshCart();
    const notified = vi.fn();
    const unsubscribe = cart.subscribe(notified);

    cart.addToCart(DRY_FOOD);

    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stop hearing about changes once unsubscribed', async () => {
    const cart = await freshCart();
    const notified = vi.fn();

    cart.subscribe(notified)();
    cart.addToCart(DRY_FOOD);

    expect(notified).not.toHaveBeenCalled();
  });

  it('see a cart another tab wrote', async () => {
    const cart = await freshCart();
    const notified = vi.fn();
    const unsubscribe = cart.subscribe(notified);

    writeFromAnotherTab(JSON.stringify([line(TOY, 4)]));

    expect(cart.getCart()).toEqual([line(TOY, 4)]);
    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('see an empty cart when another tab clears all storage', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);
    const unsubscribe = cart.subscribe(vi.fn());

    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(cart.getCart()).toEqual([]);
    unsubscribe();
  });

  it('ignore storage events for other keys', async () => {
    const cart = await freshCart();
    cart.addToCart(DRY_FOOD);
    const notified = vi.fn();
    const unsubscribe = cart.subscribe(notified);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'theme', newValue: 'dark' }),
    );

    expect(cart.getCart()).toEqual([line(DRY_FOOD, 1)]);
    expect(notified).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('recover from a corrupt cart written by another tab', async () => {
    const cart = await freshCart();
    const unsubscribe = cart.subscribe(vi.fn());

    writeFromAnotherTab('{{{');

    expect(cart.getCart()).toEqual([]);
    unsubscribe();
  });
});
