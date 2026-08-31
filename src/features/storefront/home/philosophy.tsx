import Link from 'next/link';
import { PATHS } from '@/lib/constant/paths';

/**
 * The closing statement. The eyebrow is `white/60`, not `white/40`: the
 * design review measured the original at 3.72:1 on `--ink` and it failed AA.
 */
export function PhilosophySection() {
  return (
    <section className="bg-ink py-24">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-8">
        <p className="mb-6 text-sm font-medium tracking-widest text-white/60">
          فلسفه اسموکی
        </p>
        <h2
          className="mb-6 font-black text-white"
          style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
        >
          ما هر چیزی را
          <br />
          <span className="text-accent-on-dark">نمی‌فروشیم.</span>
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-white/60">
          محصولات اسموکی با تمرکز بر کیفیت، ترکیبات، کاربرد واقعی و تجربه‌ی
          حیوانات خانگی انتخاب می‌شوند.
        </p>
        <Link
          href={PATHS.ABOUT}
          className="text-accent-on-dark border-accent-on-dark hover:text-accent-on-dark/80 border-b pb-0.5 font-medium transition-colors"
          data-umami-event="home-philosophy-about-click"
        >
          بیشتر درباره انتخاب محصولات
        </Link>
      </div>
    </section>
  );
}
