import Link from 'next/link';
import { DEFAULT_SITE_NAME } from '@/constants';
import { Button } from '@/components/ui/button';
import { API_PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';

// Placeholder storefront — the real home page is ported from `design/` by the
// front-end stories.
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        {DEFAULT_SITE_NAME}
      </h1>
      <p className="text-muted-foreground text-lg">
        فروشگاه آنلاین لوازم حیوانات خانگی
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild data-umami-event="home-backoffice-open">
          <Link href={PROTECTED_PATHS.INDEX}>پنل مدیریت</Link>
        </Button>
        {process.env.NODE_ENV !== 'production' ? (
          // /api/reference is disabled in production — don't render a dead link
          <Button asChild variant="ghost" data-umami-event="home-api-docs-open">
            <Link href={API_PATHS.REFERENCE}>مستندات API</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
