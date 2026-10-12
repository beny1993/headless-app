import { Skeleton } from '@/components/ui/skeleton';

/**
 * What an admin sees inside the panel's frame the moment they open a page,
 * while its data loads (`Story - Storefront Caching and Streaming`). The
 * sidebar and header are the layout's and stay put; this fills the content
 * area with a heading, a row of tiles and a table's worth of rows — the shape
 * most admin pages share.
 *
 * A page that answers `notFound()` (an unknown order or product id) shows its
 * «not found» with status 200 under this boundary; the panel is behind a
 * sign-in and never indexed, so nothing depends on that status. Turning away a
 * signed-out visitor or a customer stays a real redirect: `requireAdmin` runs
 * in `(protected)/layout.tsx`, above this boundary, before anything streams.
 */
export default function AdminPanelLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="در حال بارگذاری"
      data-testid="admin-panel-skeleton"
    >
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
