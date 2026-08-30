import { Metadata } from 'next';
import Link from 'next/link';
import { PATHS } from '@/lib/constant/paths';
import Layout from './(app)/layout';

export const metadata: Metadata = {
  title: 'Page Not Found',
  description: "The page you're looking for doesn't exist or has been moved.",
};

export default function NotFound() {
  return (
    <Layout>
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted-foreground text-sm font-medium">404</p>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href={PATHS.HOME}
          className="text-sm font-medium underline underline-offset-4"
          data-umami-event="not-found-home-link"
        >
          Back to home
        </Link>
      </main>
    </Layout>
  );
}
