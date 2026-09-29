'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LIFE_MOMENT_TARGETS, momentEmoji } from './content';
import type { ContentValue } from '@/lib/content/site-content';
import { imageSrc } from '@/lib/storage/image-url';
import { shopPath } from '@/lib/constant/paths';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';

/**
 * «خرید بر اساس لحظه» — a horizontal carousel of editorial entry points.
 *
 * The eyebrow, headline, «مشاهده همه» label and the five cards' title/desc/photo
 * are admin content, and so is where each card and «مشاهده همه» go (`link`,
 * `ctaLink`, resolved against `targets`). With nothing saved a card keeps its
 * code filter and emoji (`LIFE_MOMENT_TARGETS`, zipped by index) and «مشاهده همه»
 * the bare shop; a saved card wears its destination's pet (`momentEmoji`). The
 * arrows and `alt=""` (decorative — the title sits beside it) stay in code.
 *
 * Client only for the two arrow buttons: the row scrolls natively (and tabbing
 * through the cards scrolls it too), but the design review asked for explicit
 * prev/next controls for pointer users who get no scrollbar.
 */
export function LifeMomentsSection({
  content,
  targets,
}: {
  content: ContentValue<'home.moments'>;
  targets: LinkTargets;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // `direction: 1` means "further along the reading order". An RTL scroll
  // container's inline axis runs negative, so forward is a *negative*
  // scrollLeft delta — without the flip the arrows work in LTR and do nothing
  // useful here.
  //
  // The product gallery avoids this arithmetic entirely by scrolling to a
  // named slide and handing `scrollBy` the visual-rect delta to it. That does
  // not transfer: a prev/next control scrolls *by* a direction over
  // partial-width cards, and a direction is exactly what a visual rect cannot
  // supply — the sign has to come from the inline axis either way, so it is
  // read here, once, from the element's own computed direction.
  //
  // What does transfer is `behavior`: there is none, so CSS governs (the
  // `scroll-smooth` below), and the global `prefers-reduced-motion` rule in
  // globals.css — `scroll-behavior: auto !important`, which outranks the
  // utility across layers — switches the animation off without this component
  // asking `matchMedia` a question the stylesheet has already answered.
  const scrollByCards = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;

    const rtl = getComputedStyle(element).direction === 'rtl';
    element.scrollBy({
      left: (rtl ? -direction : direction) * element.clientWidth * 0.8,
    });
  };

  return (
    <section className="overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-12 flex items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-full border transition-colors"
              aria-label="اسلاید قبلی"
              data-umami-event="home-moments-prev"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-full border transition-colors"
              aria-label="اسلاید بعدی"
              data-umami-event="home-moments-next"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <ContentLink
              {...resolveLink(content.ctaLink, shopPath(), targets)}
              className="text-accent-strong ms-2 flex items-center gap-1 text-sm font-medium hover:underline"
              data-umami-event="home-moments-all-click"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {content.cta}
            </ContentLink>
          </div>
          <div className="text-end">
            <p className="text-muted-foreground mb-1 text-sm">
              {content.eyebrow}
            </p>
            <h2 className="text-4xl font-black">{content.headline}</h2>
          </div>
        </div>

        <div
          ref={scroller}
          // Both halves of hiding a scrollbar, the gallery's pair: there is no
          // `.scrollbar-hide` class in this project, and `scrollbar-width`
          // alone still paints a classic bar on Safari below 18.2 and Chromium
          // below 121. `scroll-smooth` is what the arrows above animate with.
          className="flex snap-x snap-mandatory [scrollbar-width:none] gap-5 overflow-x-auto scroll-smooth pb-4 [&::-webkit-scrollbar]:hidden"
        >
          {content.cards.map((card, index) => {
            const fallback = shopPath(LIFE_MOMENT_TARGETS[index].filters);
            return (
              <ContentLink
                // Index key: titles are editable content and may repeat.
                key={index}
                {...resolveLink(card.link, fallback, targets)}
                className="group w-64 shrink-0 snap-start md:w-72"
                data-umami-event="home-moment-click"
              >
                <div className="relative mb-4 h-80 overflow-hidden rounded-2xl">
                  <Image
                    src={imageSrc(card.image)}
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
                    {momentEmoji(card.link, index)}
                  </span>
                  <div className="absolute inset-x-4 bottom-4">
                    <h3 className="text-xl font-bold text-white">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-sm text-white/80">{card.desc}</p>
                  </div>
                </div>
              </ContentLink>
            );
          })}
        </div>
      </div>
    </section>
  );
}
