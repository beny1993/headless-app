import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'حساب کاربری' };

// Placeholder so the navigation has a real destination instead of a 404.
// The real page is ported from `design/` by its own story.
export default function Page() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black">حساب کاربری</h1>
      <p className="text-muted-foreground mt-3">
        حساب کاربری در استوری «Account Page and Pet Profiles» ساخته می‌شود.
      </p>
    </main>
  );
}
