// The shopping cart. Client-side only, in localStorage — there is no server
// cart table and no guest-merge, by decision at kickoff (`Smokey Shop Info`).
//
// **Every price here is display-only.** A line snapshots title, SKU and unit
// price at the moment it was added, so the drawer can render without a fetch;
// the values are stale by definition and a visitor can edit them freely in
// devtools. `POST /api/checkout` re-prices and re-validates every line against
// the database at order creation — that result is the only authoritative money.
//
// Two environments have to be survivable, not just the happy one:
//   · No DOM at all (Next renders the navbar on the server first) — nothing
//     touches `window` at import time or on a server read.
//   · A hostile store (corrupt JSON, a shape from an older release, Safari
//     private mode refusing to write) — the cart degrades, it never throws.
//
// Pure list helpers come first and know nothing about storage; the store below
// wraps them. React subscribes through `subscribe`/`getCart`.

/** One product in the cart, with the display snapshot taken when it was added. */
export type CartLine = {
  productId: string;
  slug: string;
  title: string;
  sku: string;
  brand?: string;
  /** Integer Toman, as `products.price`. Display-only — see the file header. */
  unitPrice: number;
  qty: number;
  /** Storage key, not a URL: `products/cat-toy.jpg` → `/products/cat-toy.jpg`. */
  imageKey?: string;
};

/** A product ready to be added; quantity is the caller's separate argument. */
export type CartLineInput = Omit<CartLine, 'qty'>;

export const CART_STORAGE_KEY = 'smokey.cart.v1';

/**
 * Per-line ceiling. Deliberately not the product's stock: this module cannot
 * know live stock, and a snapshot of it would go stale in the same breath. It
 * is a guard against a runaway stepper and an absurd stored value — the real
 * availability check is the atomic stock decrement at order creation.
 */
export const MAX_LINE_QTY = 99;

const EMPTY: readonly CartLine[] = Object.freeze([]);

const clampQty = (qty: number) => Math.min(Math.trunc(qty), MAX_LINE_QTY);

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  const isText = (field: unknown) =>
    typeof field === 'string' && field.length > 0;
  const isOptionalText = (field: unknown) =>
    field === undefined || isText(field);

  return (
    isText(line.productId) &&
    isText(line.slug) &&
    isText(line.title) &&
    isText(line.sku) &&
    isOptionalText(line.brand) &&
    isOptionalText(line.imageKey) &&
    // Money that is not a whole, positive, exactly-representable Toman amount
    // cannot be formatted or summed honestly, so the line is dropped rather
    // than shown wrong.
    typeof line.unitPrice === 'number' &&
    Number.isSafeInteger(line.unitPrice) &&
    line.unitPrice > 0 &&
    typeof line.qty === 'number' &&
    Number.isInteger(line.qty) &&
    line.qty >= 1
  );
}

/**
 * A stored payload turned into a cart. Anything unrecognisable — corrupt JSON,
 * a non-array, a line from a shape we no longer write — is dropped silently:
 * a shopper mid-purchase gets a working cart, not an error page. Surviving
 * lines are rebuilt field by field, so junk keys never accumulate in storage.
 */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isCartLine).map((line) => ({
    productId: line.productId,
    slug: line.slug,
    title: line.title,
    sku: line.sku,
    brand: line.brand,
    unitPrice: line.unitPrice,
    qty: clampQty(line.qty),
    imageKey: line.imageKey,
  }));
}

/**
 * Adds a product, or tops up the line that is already there. The existing
 * line keeps its original snapshot — the price the shopper saw when they first
 * added it stays on screen until the server re-prices at checkout.
 */
export function addLine(
  lines: readonly CartLine[],
  input: CartLineInput,
  qty = 1,
): CartLine[] {
  // `NaN < 1` is false, so a plain `qty < 1` lets `Number(<empty field>)`
  // through and puts a NaN quantity in the cart, where `cartCount` and
  // `BigInt` both blow up at render time.
  if (!Number.isFinite(qty) || qty < 1) return [...lines];
  // The same guard the stored cart is read through: a line that could not
  // survive a reload must not be shown before one either. A fractional or
  // out-of-safe-range price passes silently into the cart and then throws in
  // `lineTotal`/`formatToman`, which is the one thing this module promises
  // not to do.
  if (!isCartLine({ ...input, qty: 1 })) return [...lines];

  const existing = lines.find((line) => line.productId === input.productId);
  if (!existing) return [...lines, { ...input, qty: clampQty(qty) }];

  return lines.map((line) =>
    line.productId === input.productId
      ? { ...line, qty: clampQty(line.qty + qty) }
      : line,
  );
}

/** Sets one line's quantity. Zero or less removes it — minus at 1 empties the row. */
export function setQty(
  lines: readonly CartLine[],
  productId: string,
  qty: number,
): CartLine[] {
  // A quantity that is not a number at all is a caller bug, not an intent to
  // remove: dropping the line there would turn a stray `Number('')` into
  // silent data loss. Nothing changes instead.
  if (!Number.isFinite(qty)) return [...lines];
  if (qty < 1) return removeLine(lines, productId);

  return lines.map((line) =>
    line.productId === productId ? { ...line, qty: clampQty(qty) } : line,
  );
}

export function removeLine(
  lines: readonly CartLine[],
  productId: string,
): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

/** Units in the cart — the navbar badge and the drawer heading both show this. */
export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.qty, 0);
}

/**
 * Money is summed in `BigInt` and returned as one: integer Toman can outgrow
 * `Number.MAX_SAFE_INTEGER` once a price is multiplied by a quantity, and a
 * silently rounded total is the one bug this codebase refuses to ship.
 * `formatToman` takes the bigint straight.
 */
export function lineTotal(line: CartLine): bigint {
  return BigInt(line.unitPrice) * BigInt(line.qty);
}

export function cartTotal(lines: readonly CartLine[]): bigint {
  return lines.reduce((total, line) => total + lineTotal(line), 0n);
}

// ─── The stored cart ─────────────────────────────────────────────────────────

// `null` means "not read yet" — the first read happens on demand, never at
// import, so a server render can import this module safely. React's
// `useSyncExternalStore` also requires the snapshot to keep the same identity
// between changes, which this cache is what provides.
let cache: readonly CartLine[] | null = null;

const listeners = new Set<() => void>();

function readStorage(): readonly CartLine[] {
  try {
    return parseCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    // Storage can be unreachable outright (sandboxed iframe, blocked cookies).
    return EMPTY;
  }
}

/**
 * The current cart. Stable by reference until something changes it, and always
 * the same empty cart on the server — both are what React needs to render it.
 */
export function getCart(): readonly CartLine[] {
  if (typeof window === 'undefined') return EMPTY;
  cache ??= readStorage();
  return cache;
}

/**
 * The cart React hydrates from — always empty, deliberately.
 *
 * `getCart` cannot serve this role even though it is empty on the server:
 * React calls the server snapshot a second time *on the client*, for the
 * hydrating render, and there `window` and a populated localStorage both
 * exist. A returning shopper would hydrate a badge the server never rendered,
 * which React rejects as a hydration failure. The stored cart arrives on the
 * re-render immediately after.
 */
export function getServerCart(): readonly CartLine[] {
  return EMPTY;
}

function commit(next: readonly CartLine[]) {
  // In-memory first, storage second: when the write is refused the shopper
  // still gets a cart for this session instead of a dead button.
  cache = next;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, quota, blocked storage. Nothing to recover — carry on.
  }
  listeners.forEach((listener) => listener());
}

export function addToCart(input: CartLineInput, qty = 1): void {
  commit(addLine(getCart(), input, qty));
}

export function setLineQty(productId: string, qty: number): void {
  commit(setQty(getCart(), productId, qty));
}

export function removeFromCart(productId: string): void {
  commit(removeLine(getCart(), productId));
}

export function clearCart(): void {
  commit([]);
}

// Another tab changed the shared storage. `key === null` is that tab calling
// `localStorage.clear()`, which wipes ours too; any other key is somebody
// else's data. Re-read rather than trusting `newValue`: storage is the shared
// truth, and the event can only ever be a copy of it.
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== CART_STORAGE_KEY) return;
  cache = null;
  listeners.forEach((listener) => listener());
}

/** Subscribes to cart changes from this tab and from any other one. */
export function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  listeners.add(onChange);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}
