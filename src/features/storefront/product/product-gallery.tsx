'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/** One image as the product page reads it — a storage key, not a URL. */
export type GalleryImage = { id: string; objectKey: string };

/**
 * How long a jump is given to settle before snapping is restored regardless.
 * The only restore on iOS Safari below 18.2 (no `scrollend`), and on a jump
 * that scrolls nowhere (a zero delta fires no `scrollend` either).
 */
const SCROLL_SETTLE_MS = 600;

/** Two slides touch the track mid-swipe; the one mostly showing counts. */
const VISIBLE_ENOUGH = 0.6;

/**
 * The product gallery: a CSS scroll-snap track of full-width photos (no
 * carousel library), plus a thumbnail strip when there is more than one.
 * `snap-always` lands a flick on exactly one photo; `overscroll-x-contain`
 * keeps a swipe past the end from triggering the browser's back gesture. The
 * scrollbar is hidden, or a classic Windows/Linux scrollbar paints across the
 * photo.
 *
 * **RTL: never do `scrollLeft` arithmetic** — its sign differs across engines.
 *   · Reading the active slide is an `IntersectionObserver` rooted on the
 *     track: sign-free, and the single source of truth (`aria-pressed` follows
 *     it, not the click, so a swipe and a click cannot disagree).
 *   · Writing is a visual-rect delta handed to `scrollBy` — correct under the
 *     modern and positive-increasing models, which covers every target engine,
 *     and unlike `scrollIntoView` it never scrolls the page vertically.
 *   · Neither passes `behavior`, so `scroll-smooth` and the global
 *     `prefers-reduced-motion` rule govern the animation.
 *
 * The thumbnails are buttons with `aria-pressed` — the keyboard path; no RTL
 * arrow controls, no dots. The call site passes `key={product.id}`, or
 * `active` survives a client-side navigation onto another product's photos.
 */
export function ProductGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLUListElement>(null);
  /** Restores snapping after a programmatic jump, or null when none is owed. */
  const restore = useRef<(() => void) | null>(null);
  const slideRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // A batch holds every slide that crossed, leavers included, and
        // `isIntersecting` is true for any overlap: take the widest-showing.
        const showing = entries
          .filter((entry) => entry.intersectionRatio >= VISIBLE_ENOUGH)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!showing) return;
        const index = Number(
          (showing.target as HTMLElement).dataset.slideIndex,
        );
        if (Number.isInteger(index)) setActive(index);
      },
      { root: track, threshold: VISIBLE_ENOUGH },
    );
    for (const slide of slideRefs.current) {
      if (slide) observer.observe(slide);
    }
    return () => observer.disconnect();
    // Keyed on identity, not `length`: new photos mean new `<li>` nodes, and
    // a count-only dependency would leave the observer watching dead ones.
  }, [images]);

  /** Scroll the track to a slide. The observer then reports where it landed. */
  const show = (index: number) => {
    const track = trackRef.current;
    const slide = slideRefs.current[index];
    // Nothing to scroll: no observer will answer, so set the index directly.
    if (!track || !slide) {
      setActive(index);
      return;
    }

    // `snap-always` stops *any* scroll at the first snap point, programmatic
    // included, so a jump two photos away would land one short: snapping is
    // off for the trip. One owner for the restore, so a second tap cannot
    // have the first tap's timer fire mid-flight.
    restore.current?.();
    track.style.scrollSnapType = 'none';
    track.scrollBy({
      left:
        slide.getBoundingClientRect().left - track.getBoundingClientRect().left,
    });

    const resume = () => {
      window.clearTimeout(timer);
      track.removeEventListener('scrollend', resume);
      restore.current = null;
      track.style.scrollSnapType = '';
      // A no-op in Chrome (restoring the property re-snaps); here for WebKit,
      // untested. If a gallery is ever seen parked between two photos,
      // suspect this line: it can abort a smooth re-snap mid-flight.
      track.scrollTo({ left: track.scrollLeft });
    };
    restore.current = resume;
    track.addEventListener('scrollend', resume);
    const timer = window.setTimeout(resume, SCROLL_SETTLE_MS);
  };

  // A finger on the track takes the gesture back, so snapping must be on for
  // it even if the jump it interrupts has not settled.
  const onTrackPointerDown = () => restore.current?.();

  // Unmount only: an `[images]` teardown could fire mid-jump and park a slide
  // short.
  useEffect(() => () => restore.current?.(), []);

  if (images.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-secondary flex aspect-square items-center justify-center overflow-hidden rounded-3xl">
          <ShoppingBag
            size={48}
            className="text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* No `tabIndex`: recent Chrome makes a scroller a tab stop on its own,
          which is exactly why the track carries a name — so that stop has one. */}
      <ul
        ref={trackRef}
        aria-label="گالری تصاویر محصول"
        onPointerDown={onTrackPointerDown}
        // Both: `scrollbar-width` alone still paints on pre-121 Chromium and
        // Safari.
        className="bg-secondary flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain scroll-smooth rounded-3xl [&::-webkit-scrollbar]:hidden"
        // Umami tracks clicks only, so the event is named for a tap.
        data-umami-event="product-gallery-photo-tap"
      >
        {images.map((image, index) => (
          <li
            key={image.id}
            data-slide-index={index}
            ref={(slide) => {
              slideRefs.current[index] = slide;
            }}
            className="relative aspect-square w-full shrink-0 snap-start snap-always"
          >
            <Image
              src={imageSrc(image.objectKey)}
              // The opening photo is the page's subject: titled. The rest are
              // numbered — real views, so neither `alt=""` nor the title again.
              alt={
                index === 0
                  ? title
                  : `تصویر ${formatNumber(index + 1)} از ${title}`
              }
              fill
              // `preload`, not `priority` (deprecated in Next 16).
              preload={index === 0}
              // Not lazy: a slide clipped by `overflow-x` would load only
              // mid-swipe and pop in. Low priority past the first, so the rest
              // do not compete with the LCP image.
              loading="eager"
              fetchPriority={index === 0 ? 'high' : 'low'}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </li>
        ))}
      </ul>

      {images.length > 1 && (
        <div
          className="flex flex-wrap gap-3"
          role="group"
          aria-label="تصاویر محصول"
        >
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => show(index)}
              aria-pressed={index === active}
              aria-label={`نمایش تصویر ${formatNumber(index + 1)}`}
              className={`size-16 overflow-hidden rounded-xl border-2 transition-colors ${
                index === active ? 'border-accent-strong' : 'border-border'
              }`}
              data-umami-event="product-gallery-thumb-select"
            >
              <Image
                src={imageSrc(image.objectKey)}
                alt=""
                width={64}
                height={64}
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
