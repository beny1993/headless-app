// The admin product list's URL contract: what `/admin-panel/products?…` may
// carry, and how to write it back. The same split `shop-query.ts` makes for the
// storefront listing — the route file reads the URL through this and stays a
// page, and the href builder gets a test beside it.
//
// Page-level input degrades rather than 400s (the always-zod rule for pages): a
// bad value falls back to "no filter" via `.catch`, never throws.
import { z } from 'zod';
import { PET_TYPE_VALUES } from '@/lib/catalog/product-query';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { pageParamSchema } from '@/lib/pagination';

/** Active filter as it appears in the URL; mapped to the DAO's `active` below. */
const ACTIVE_VALUES = ['all', 'active', 'inactive'] as const;
type ActiveValue = (typeof ACTIVE_VALUES)[number];

export const adminProductFilterSchema = z.object({
  q: z.string().trim().min(1).optional().catch(undefined),
  category: z.string().trim().min(1).optional().catch(undefined),
  pet: z.enum(PET_TYPE_VALUES).optional().catch(undefined),
  active: z.enum(ACTIVE_VALUES).catch('all'),
  page: pageParamSchema,
});

export type AdminProductFilters = z.infer<typeof adminProductFilterSchema>;

/** The URL's tri-state, as `ProductDao.pageForAdmin` wants it. */
export const activeToFilter = (value: ActiveValue): boolean | undefined =>
  value === 'all' ? undefined : value === 'active';

/** The list's URL for one page, keeping the filters; page one has no `page`. */
export const productsHref = (
  filters: AdminProductFilters,
  page: number,
): string => {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  if (filters.pet) params.set('pet', filters.pet);
  if (filters.active !== 'all') params.set('active', filters.active);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search
    ? `${PROTECTED_PATHS.PRODUCTS}?${search}`
    : PROTECTED_PATHS.PRODUCTS;
};
