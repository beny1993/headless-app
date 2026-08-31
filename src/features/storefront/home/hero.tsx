import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { HERO_IMAGE } from './content';
import { PATHS, shopPath } from '@/lib/constant/paths';

/**
 * The home hero.
 *
 * The prototype's hero is `min-h-screen` under a transparent navbar; ours sits
 * below a solid one (see `navbar.tsx`), so it takes the viewport minus the
 * navbar's 4rem instead of overlapping it.
 *
 * Text sits on `--ink` with the photo at 50% opacity plus a gradient — that is
 * what makes white body copy and `--accent-on-dark` land at their measured
 * contrast ratios rather than floating over an unpredictable photograph.
 */
export function HeroSection() {
  return (
    <section className="bg-ink relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden">
      <div className="absolute inset-0">
        <Image
          src={HERO_IMAGE}
          alt="سگی آرام در فضای خانه"
          fill
          // The page's LCP element: it must not be lazy-loaded, and it is
          // always full-bleed.
          priority
          sizes="100vw"
          className="object-cover opacity-50"
        />
        <div className="from-ink/90 via-ink/50 absolute inset-0 bg-gradient-to-l to-transparent" />
      </div>

      {/* Decoration only — direction-neutral, so physical placement is fine. */}
      <div className="bg-accent/10 absolute top-1/2 left-0 h-[500px] w-[500px] -translate-y-1/2 rounded-full blur-3xl" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-16 sm:px-8 lg:px-12">
        <div className="max-w-2xl">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="text-accent-on-dark text-sm font-medium tracking-widest">
              زندگی با اسموکی
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
              <span aria-hidden="true">🐱</span> گربه
              <span className="mx-1 text-white/40" aria-hidden="true">
                ·
              </span>
              <span aria-hidden="true">🐶</span> سگ
            </span>
          </div>

          <h1
            className="mb-6 font-black text-white"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1.2 }}
          >
            زندگی بهتر،
            <br />
            کنار بهترین
            <br />
            <span className="text-accent-on-dark">دوستت</span>
          </h1>

          <p className="mb-10 max-w-lg text-lg leading-relaxed text-white/70">
            محصولاتی که با دقت برای سلامت، شادی و زندگی روزمره‌ی گربه‌ها و سگ‌ها
            انتخاب شده‌اند.
          </p>

          <div className="flex flex-wrap gap-4">
            <Link
              href={shopPath()}
              className="bg-accent-strong hover:bg-accent-hover rounded-xl px-8 py-4 font-bold text-white transition-[transform,background-color] duration-200 hover:scale-105"
              data-umami-event="home-hero-shop-click"
            >
              کشف محصولات
            </Link>
            <Link
              href={PATHS.ABOUT}
              className="rounded-xl border border-white/20 bg-white/10 px-8 py-4 font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/20"
              data-umami-event="home-hero-about-click"
            >
              داستان اسموکی
            </Link>
          </div>
        </div>
      </div>

      {/* Scroll hint. The global reduce-motion block stops the bounce. */}
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-white/60"
        aria-hidden="true"
      >
        <ChevronDown size={20} />
      </div>
    </section>
  );
}
