// Which admin nav entry is current. Exactly one wins, so a page nested under
// another entry's path — «دسته‌بندی‌ها» at /admin-panel/products/categories,
// under «محصولات» — highlights only itself: the longest matching href wins.
// Prefix matches respect segment boundaries, so /admin-panel/products-archive is
// not a products page.
export type NavMatch = {
  href: string;
  /** `exact`: only `href` itself. `prefix`: `href` or any path below it. */
  match: 'exact' | 'prefix';
};

export function activeHref(
  pathname: string,
  items: readonly NavMatch[],
): string | null {
  let best: string | null = null;
  for (const { href, match } of items) {
    const hit =
      pathname === href ||
      (match === 'prefix' && pathname.startsWith(`${href}/`));
    if (hit && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
