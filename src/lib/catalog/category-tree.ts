// The one place a flat category list becomes a tree. `GET /api/categories` and
// `CategoryDao.list()` stay flat rows carrying `parentId`; the home strip, the
// shop filter, the three category selects and the admin manager all order them
// through here, so they cannot drift into five different ideas of «under».
//
// **Nothing here may import drizzle or `pg`** — the shop filter and the product
// form are client components. Pure, no imports at all.

/** The «— » that stands in for an indent inside a flat `<option>` list. */
export const SUBCATEGORY_PREFIX = '— ';

/**
 * How many top-level categories the home strip shows — the ones picked in the
 * home content first, then by sort order and title (`homeTiles`). The admin
 * manager's photo hint quotes it, so a photo an admin is told will show is one
 * the strip renders.
 */
export const HOME_CATEGORY_TILES = 6;

/**
 * The home strip's tiles: the main categories picked in the home content, in the
 * order picked, then the rest in display order — up to `HOME_CATEGORY_TILES`, so
 * the mosaic stays full however few were picked. `main` is the top-level rows,
 * already in display order. A pick no longer among them (deleted since, or made
 * a sub-category) drops out, and the next one takes its place.
 */
export function homeTiles<T extends { id: string }>(
  main: readonly T[],
  picked: readonly string[] | undefined,
): T[] {
  const chosen = (picked ?? []).flatMap((id) => {
    const tile = main.find((row) => row.id === id);
    return tile ? [tile] : [];
  });
  const rest = main.filter((row) => !chosen.includes(row));
  return [...chosen, ...rest].slice(0, HOME_CATEGORY_TILES);
}

type Node = { id: string; parentId: string | null };

/**
 * Top-level rows in input order, each followed by its own children in input
 * order. Rows arrive already sorted (the DAO's storefront order, the manager's
 * own sort), so nothing is re-ordered here beyond the nesting.
 *
 * A row whose parent is absent from `rows`, or whose parent is itself a child,
 * is emitted at the top level rather than dropped: the one-level rule lives in
 * `CategoryDao` and the database, and a list that silently hides a malformed
 * row would leave an admin with no way to see — or fix — it.
 */
export function orderAsTree<T extends Node>(
  rows: readonly T[],
): (T & { depth: 0 | 1 })[] {
  const topLevel = new Set(
    rows.filter((row) => row.parentId === null).map((row) => row.id),
  );
  const isSub = (row: T) => row.parentId !== null && topLevel.has(row.parentId);

  const children = new Map<string, T[]>();
  for (const row of rows.filter(isSub)) {
    const siblings = children.get(row.parentId!);
    if (siblings) siblings.push(row);
    else children.set(row.parentId!, [row]);
  }

  return rows.flatMap((row) =>
    isSub(row)
      ? []
      : [
          { ...row, depth: 0 as const },
          ...(children.get(row.id) ?? []).map((child) => ({
            ...child,
            depth: 1 as const,
          })),
        ],
  );
}

/**
 * Every category select's options: tree order, sub-categories prefixed. Flat
 * rather than `<optgroup>`ed on purpose — a parent may hold products itself, so
 * it has to stay selectable, and an optgroup label is not.
 *
 * `title` comes along beside `label` because the prefix encodes depth *inside a
 * flat option list*, and a chip is not a list — the product form's additional
 * categories render the plain title and would otherwise have to strip the
 * prefix back off, which is the same rule written twice.
 */
export function categoryOptions<
  T extends Node & { title: string; slug: string },
>(
  rows: readonly T[],
): { id: string; slug: string; title: string; label: string }[] {
  return orderAsTree(rows).map(({ id, slug, title, depth }) => ({
    id,
    slug,
    title,
    label: depth === 1 ? `${SUBCATEGORY_PREFIX}${title}` : title,
  }));
}
