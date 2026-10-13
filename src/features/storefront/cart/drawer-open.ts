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
// environment).
//
// It holds one piece of state: an open that no drawer heard. The drawer
// subscribes in an effect, and React runs a hydration's effects a scheduler
// task after its commit, while the add button is live from the commit itself.
// A shopper who taps add as the product page finishes loading lands in that
// gap: the line is saved and, without this, the drawer stays shut. So that open
// is kept and handed to the next drawer that subscribes, once. It is the same
// check `useSyncExternalStore` makes for the cart when it subscribes (re-read
// what changed meanwhile), which is why the badge never had this bug. A counter
// store the drawer reads through `useSyncExternalStore` would need no time
// bound, at the cost of a bigger change to the drawer.
//
// The open is kept for `UNHEARD_OPEN_MS` only. Every page with the add button
// has the navbar today; the bound stops a page that one day does not from
// opening the drawer on whatever page the shopper reaches next. Only click
// handlers call `openCartDrawer`, so on the server, where nothing ever
// subscribes, it is never set.

/**
 * How long an open no drawer heard waits for one to subscribe. The gap it
 * covers runs from React's commit to the task that runs its passive effects;
 * the rest is margin.
 */
export const UNHEARD_OPEN_MS = 5_000;

const listeners = new Set<() => void>();

/** When an open last found no drawer listening, until a drawer subscribes. */
let unheardAt: number | undefined;

/**
 * Opens the cart drawer, or the next one to subscribe if none is listening
 * yet (see above). Never throws for want of a drawer.
 */
export function openCartDrawer(): void {
  if (listeners.size === 0) {
    unheardAt = Date.now();
    return;
  }
  // Copied before iterating so one call notifies exactly the drawers that were
  // subscribed when it started. Unsubscribing mid-notify would be safe without
  // the copy — deleting from a `Set` being iterated is well-defined and the
  // remaining listeners still run — but *subscribing* mid-notify is not: a live
  // `Set` hands the newly added listener to the same pass, so a drawer that
  // resubscribed while opening would be opened twice, or forever.
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribes a mounted drawer, handing it an open that no drawer heard if one
 * is waiting. Returns its own removal function — React 19 StrictMode mounts an
 * effect twice, so two subscriptions can be live at once and each must be
 * removable without touching the other.
 */
export function subscribeToCartDrawer(open: () => void): () => void {
  listeners.add(open);
  // Taken by the first drawer to subscribe, fresh or not, so StrictMode's
  // second subscription, or a second drawer, finds nothing.
  if (unheardAt !== undefined) {
    const fresh = Date.now() - unheardAt <= UNHEARD_OPEN_MS;
    unheardAt = undefined;
    if (fresh) open();
  }
  return () => {
    listeners.delete(open);
  };
}
