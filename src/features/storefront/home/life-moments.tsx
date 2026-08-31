'use client';

import { useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LIFE_MOMENTS } from './content';
import { shopPath } from '@/lib/constant/paths';

/**
 * «خرید بر اساس لحظه» — a horizontal carousel of editorial entry points.
 *
 * Client only for the two arrow buttons: the row scrolls natively (and tabbing
 * through the cards scrolls it too), but the design review asked for explicit
 * prev/next controls for pointer users who get no scrollbar.
 */
export function LifeMomentsSection() {
  const scroller = useRef<HTMLDivElement>(null);

  // `direction: 1` means "further along the reading order". An RTL scroll
  // container's inline axis runs negative, so forward is a *negative*
  // scrollLeft delta — without the flip the arrows work in LTR and do nothing
  // useful here (design review, finding 9).
  const scrollByCards = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;

    const rtl = getComputedStyle(element).direction === 'rtl';
    element.scrollBy({
      left: (rtl ? -direction : direction) * element.clientWidth * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

  return (
    <section className="overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-12 flex items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-full border transition-colors"
              aria-label="اسلاید بعدی"
              data-umami-event="home-moments-next"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-full border transition-colors"
              aria-label="اسلاید قبلی"
              data-umami-event="home-moments-prev"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <Link
              href={shopPath()}
              className="text-accent-strong ms-2 flex items-center gap-1 text-sm font-medium hover:underline"
              data-umami-event="home-moments-all-click"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              مشاهده همه
            </Link>
          </div>
          <div className="text-end">
            <p className="text-muted-foreground mb-1 text-sm">
              خرید بر اساس لحظه
            </p>
            <h2 className="text-4xl font-black">زندگی با حیوانات خانگی</h2>
          </div>
        </div>

        <div
          ref={scroller}
          className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4"
          // No `.scrollbar-hide` class exists in this codebase and the
          // prototype's was undefined too; this is the real property.
          style={{ scrollbarWidth: 'none' }}
        >
          {LIFE_MOMENTS.map((moment) => (
            <Link
              key={moment.title}
              href={shopPath(moment.filters)}
              className="group w-64 shrink-0 snap-start md:w-72"
              data-umami-event="home-moment-click"
            >
              <div className="relative mb-4 h-80 overflow-hidden rounded-2xl">
                <Image
                  src={moment.image}
                  alt=""
                  fill
                  sizes="288px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span
                  className="absolute end-3 top-3 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-sm text-white backdrop-blur-sm"
                  aria-hidden="true"
                >
                  {moment.emoji}
                </span>
                <div className="absolute inset-x-4 bottom-4">
                  <h3 className="text-xl font-bold text-white">
                    {moment.title}
                  </h3>
                  <p className="mt-1 text-sm text-white/80">{moment.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
