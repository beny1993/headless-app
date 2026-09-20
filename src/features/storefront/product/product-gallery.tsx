'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/** One image as the product page reads it — a storage key, not a URL. */
export type GalleryImage = { id: string; objectKey: string };

/**
 * The product gallery: a horizontal track of full-width photos a finger can
 * swipe, and thumbnails when there is more than one to choose from.
 *
 * The track is CSS scroll-snap and nothing else — no carousel library, no
 * transform arithmetic. `snap-always` so a fast flick lands on exactly one
 * photo (otherwise the strip and the big image disagree about where you ended
 * up), and `overscroll-x-contain` so swiping past the last photo does not
 * trigger the browser's back gesture. It renders even for a single image: one
 * code path, and snapping a single slide is inert. Desktop looks exactly as it
 * did — the track is one slide wide there and never scrolls.
 *
 * **The RTL trap, avoided by never doing the arithmetic.** `scrollLeft` in RTL
 * is zero at the start and *negative* toward the end in the modern CSSOM-View
 * model, and positive-decreasing or positive-increasing in older ones. Nothing
 * here depends on that:
 *
 *   · Reading the active slide is an `IntersectionObserver` rooted on the
 *     track — sign-free, and the single source of truth. The thumbnails'
 *     `aria-pressed` follows the observer rather than the click, so a swipe and
 *     a click can never disagree about which photo is showing.
 *   · Writing it is a visual-rect delta handed to `scrollBy`, which is
 *     direction-agnostic and, unlike `scrollIntoView`, never yanks the page
 *     vertically when the thumb sits below the fold.
 *   · Neither call passes `behavior`, so CSS `scroll-smooth` governs and the
 *     global `prefers-reduced-motion` rule switches the animation off for free.
 *
 * The thumbnails are real buttons carrying `aria-pressed`, not the design
 * review's clickable `<div>`s (finding 2) — keyboard reachable, and the
 * selected one is announced rather than only outlined. They are the keyboard
 * path; the swipe is a second way to do the same thing, never the only one.
 * Nothing is direction-sensitive: no arrow control whose direction could be
 * wrong in RTL (finding 9's carousel bug), and no dots, because the 64px strip
 * is visible at 375px and already *is* the position indicator, with names.
 * The 64px thumbs clear the 40px touch-target floor (finding 6).
 *
 * A product with a single image renders no strip at all: a one-item picker is a
 * control that cannot do anything.
 *
 * The call site passes `key={product.id}`. Without it React keeps this
 * component's tree position across a client-side navigation from one product to
 * another, and `active` — photo #4, say — survives onto a product whose gallery
 * is a different set of photos entirely.
 */
/**
 * How long a smooth scroll across the track is given to settle before snapping
 * is restored regardless. Only a fallback: `scrollend` normally gets there
 * first. Long enough for a slow full-width scroll, short enough that a visitor
 * who flicks immediately afterwards still gets the snap.
 */
const SCROLL_SETTLE_MS = 600;

export function ProductGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLUListElement>(null);
  const slideRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length < 2) return;

    // 0.6 rather than a bare 0: two slides touch the viewport mid-swipe, and
    // the one that is mostly showing is the one that counts.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(
            (entry.target as HTMLElement).dataset.slideIndex,
          );
          if (Number.isInteger(index)) setActive(index);
        }
      },
      { root: track, threshold: 0.6 },
    );
    for (const slide of slideRefs.current) {
      if (slide) observer.observe(slide);
    }
    return () => observer.disconnect();
  }, [images.length]);

  /** Scroll the track to a slide. The observer then reports where it landed. */
  const show = (index: number) => {
    const track = trackRef.current;
    const slide = slideRefs.current[index];
    // No track to scroll (a lone image, or before the refs attach): set the
    // index directly, since no observer is going to answer for it.
    if (!track || !slide) {
      setActive(index);
      return;
    }

    // `snap-always` (`scroll-snap-stop: always`) on every slide refuses to let
    // *any* scroll pass a snap point — a programmatic one included, animated or
    // not. So a thumb two or more photos away used to land one slide short: the
    // container stopped at the first snap point on the way and stayed there.
    // The rule earns its place on a flick, which is a gesture the visitor is
    // still driving; it has no business governing a jump to a named photo. Off
    // for the trip, back on when we arrive.
    const resume = () => {
      track.style.scrollSnapType = '';
    };
    track.style.scrollSnapType = 'none';
    track.scrollBy({
      left:
        slide.getBoundingClientRect().left - track.getBoundingClientRect().left,
    });
    // `scrollend` is the precise signal and fires in every engine the shop
    // targets; the timer is for the ones where it does not, and running twice
    // is harmless — the second assignment writes the same empty string.
    track.addEventListener('scrollend', resume, { once: true });
    window.setTimeout(resume, SCROLL_SETTLE_MS);
  };

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
        className="bg-secondary flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth rounded-3xl"
        data-umami-event="product-gallery-swipe"
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
              // A storage key, not a URL: `imageSrc` resolves it — bundled
              // `products/…` from public/, an `uploads/…` object from the bucket.
              src={imageSrc(image.objectKey)}
              // The opening photo is described, unlike the card's decorative
              // thumbnail: here the image is the subject of the page, and it is
              // the only place a non-sighted visitor learns one exists. The
              // rest are numbered — all of them sit in the a11y tree inside a
              // scroll container, so `alt=""` on four real views of the product
              // would be a lie and five repetitions of the title just noise.
              alt={
                index === 0
                  ? title
                  : `تصویر ${formatNumber(index + 1)} از ${title}`
              }
              fill
              priority={index === 0}
              // Not lazy: a lazy image in a horizontal scroller pops in
              // mid-swipe, and five WebPs at these sizes are small.
              loading="eager"
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
