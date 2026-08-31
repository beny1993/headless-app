import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'تکمیل خرید' };

// Placeholder so the cart drawer's CTA has a real destination instead of a 404.
// The three-step wizard is ported from `design/` by its own story.
export default function Page() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black">تکمیل خرید</h1>
      <p className="text-muted-foreground mt-3">
        مراحل تکمیل خرید در استوری «Checkout Flow Frontend» ساخته می‌شود.
      </p>
    </main>
  );
}
