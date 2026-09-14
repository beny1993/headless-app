import { Pagination } from '@/components/ui/pagination';
import { buildShopHref, updateShopQuery, type ShopQuery } from './shop-query';

/**
 * The shop's page links: the shared pager, with each page's URL built from the
 * shop query so the filters survive paging.
 */
export function ShopPagination({
  query,
  totalPages,
}: {
  query: ShopQuery;
  totalPages: number;
}) {
  return (
    <Pagination
      page={query.page}
      totalPages={totalPages}
      hrefFor={(page) => buildShopHref(updateShopQuery(query, { page }))}
      label="صفحه‌بندی محصولات"
      event="shop-pagination"
      className="mt-10"
    />
  );
}
