// Paging shared by every paged list: the storefront shop and the admin panel's
// products and orders tables. Client-safe (plain zod, no DB), so pages, server
// components and tests all read one definition.
import { z } from 'zod';

/** Rows per page in the admin panel's tables. */
export const ADMIN_PAGE_SIZE = 20;

/**
 * A page's `?page=` search param: anything but a whole page number from 1 up
 * reads as the first page instead of failing the render (pages degrade, APIs
 * reject). `.int()` is load-bearing beyond "no decimals": zod 4 caps it at
 * `Number.MAX_SAFE_INTEGER`, which keeps `?page=1e20` from reaching Postgres as
 * an `OFFSET` no `bigint` can hold.
 */
export const pageParamSchema = z.coerce.number().int().min(1).catch(1);

/**
 * The page numbers to draw links for: at most `size` of them, centred on the
 * current page and never pointing outside the list, including when the URL asks
 * for a page that does not exist, which is exactly when a way back matters.
 */
export function pageWindow(
  page: number,
  totalPages: number,
  size = 5,
): number[] {
  if (totalPages < 1) return [];

  const span = Math.min(size, totalPages);
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = Math.min(
    Math.max(current - Math.floor(span / 2), 1),
    totalPages - span + 1,
  );

  return Array.from({ length: span }, (_, index) => start + index);
}
