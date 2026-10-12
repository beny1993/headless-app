import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a shopper sees the moment they open «حساب کاربری» or one of their
 * orders, while the session check and their orders, pets and addresses load
 * (`Story - Storefront Caching and Streaming`). Shaped like the account page:
 * the name row, the tab rail, a few order rows.
 *
 * Safe here, and only here among the storefront's pages: once this streams the
 * answer is 200. So a missing order's 404 arrives as a noindexed «not found»
 * page, and a signed-out visit's `requireSession` redirect arrives as a
 * streamed client redirect to `/login?next=…` rather than a 307 — a browser
 * lands in the same place, only a status check sees the difference. Fine for
 * pages no crawler can sign in to. `/shop` and `/product/[slug]` must keep
 * their real 404s and have no loading.tsx.
 */
export default function AccountLoading() {
  return (
    <main
      className="min-h-screen pt-4"
      role="status"
      aria-busy="true"
      aria-label="در حال بارگذاری حساب کاربری"
      data-testid="account-skeleton"
    >
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
        <div className="mb-8 flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="flex gap-2 lg:w-52 lg:flex-col">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton
                key={index}
                className="h-11 w-24 rounded-xl lg:w-full"
              />
            ))}
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-6 w-36" />
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
