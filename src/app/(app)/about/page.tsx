import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'درباره ما' };

// Placeholder so the navigation has a real destination instead of a 404.
// The real page is ported from `design/` by its own story.
export default function Page() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black">درباره ما</h1>
      <p className="text-muted-foreground mt-3">
        صفحه درباره ما در استوری مربوط به خودش ساخته می‌شود.
      </p>
    </main>
  );
}
