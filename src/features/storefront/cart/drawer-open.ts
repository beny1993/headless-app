// Opening the cart drawer from somewhere that is not the navbar.
//
// The drawer is a native modal `<dialog>` owned by `CartDrawer`, which lives in
// the navbar because the badge and the panel render the same cart. The product
// page's add button has to open that dialog from a different branch of the tree
// («…writes to the local cart *and* opens the drawer», story AC), and there are
// only so many ways to bridge that:
//
//   · A window global — untestable, and invisible to anyone reading the drawer.
//   · Lifting the cart into a context provider — a provider, a hook and a
//     re-render of the whole storefront layout, to move one boolean.
//   · This: the same listener-set shape `cart.ts` already uses for its own
//     `subscribe`, in the feature that owns the drawer.
//
// Deliberately free of any DOM reference, because the components that import it
// render on the server first (proved in ./drawer-open.test.ts, node
// environment). It carries no state either: there is nothing to read back, only
// an event to deliver. If nobody is listening — a page rendered without the
// navbar — opening is simply a no-op, never a crash.

const listeners = new Set<() => void>();

/** Opens the cart drawer, if one is mounted. Safe to call during SSR. */
export function openCartDrawer(): void {
  // Copied before iterating: a listener that unsubscribes while being notified
  // would otherwise mutate the set mid-iteration.
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribes a mounted drawer. Returns its own removal function — React 19
 * StrictMode mounts an effect twice, so two subscriptions can be live at once
 * and each must be removable without touching the other.
 */
export function subscribeToCartDrawer(open: () => void): () => void {
  listeners.add(open);
  return () => {
    listeners.delete(open);
  };
}
