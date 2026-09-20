'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/** One image as the product page reads it — a storage key, not a URL. */
export type GalleryImage = { id: string; objectKey: string };

/**
 * How long a smooth scroll across the track is given to settle before snapping
 * is restored regardless.
 *
 * Not merely a fallback: iOS Safari below 18.2 has no `scrollend` at all, so
 * on those engines this timer is the *only* restore. It also covers a jump
 * that scrolls nowhere — tapping the thumbnail of the photo already showing
 * computes a zero delta, and a scroll that never happens fires no `scrollend`
 * either.
 */
const SCROLL_SETTLE_MS = 600;

/**
 * How much of a slide has to be showing before it counts as the one on screen.
 * Two slides touch the track mid-swipe; the one mostly showing wins.
 */
const VISIBLE_ENOUGH = 0.6;

/**
 * The product gallery: a horizontal track of full-width photos a finger can
 * swipe, and thumbnails when there is more than one to choose from.
 *
 * The track is CSS scroll-snap and nothing else — no carousel library, no
 * transform arithmetic. `snap-always` so a fast flick lands on exactly one
 * photo, and `overscroll-x-contain` so swiping past the last photo does not
 * trigger the browser's back gesture. It renders even for a single image: one
 * code path, and snapping a single slide is inert.
 *
 * It is a real scroller at every width — every thumbnail click scrolls it, and
 * a trackpad can — so it hides its scrollbar the way the home page's snap
 * scroller does. Without that, a classic (non-overlay) scrollbar paints across
 * the bottom of the photo on Windows and Linux, which is most of this shop's
 * desktop traffic and which no macOS reviewer or CI run would ever see.
 *
 * **The RTL trap, avoided by never doing the arithmetic.** `scrollLeft` in RTL
 * is zero at the start and *negative* toward the end in the modern CSSOM-View
 * model, and positive-decreasing or positive-increasing in older ones:
 *
 *   · Reading the active slide is an `IntersectionObserver` rooted on the
 *     track — sign-free, and the single source of truth. The thumbnails'
 *     `aria-pressed` follows the observer rather than the click, so a swipe and
 *     a click cannot disagree about which photo is showing.
 *   · Writing it is a visual-rect delta handed to `scrollBy`. That is
 *     sign-*correct*, not sign-*free*: `scrollBy` writes into the same
 *     coordinate system, and the delta is right under the modern model and
 *     under positive-increasing. No engine this shop targets uses
 *     positive-decreasing, where it would scroll the wrong way. Unlike
 *     `scrollIntoView` it never yanks the page vertically.
 *   · Neither call passes `behavior`, so CSS `scroll-smooth` governs and the
 *     global `prefers-reduced-motion` rule switches the animation off for free.
 *
 * The thumbnails are real buttons carrying `aria-pressed`, not the design
 * review's clickable `<div>`s — keyboard reachable, and the selected one is
 * announced rather than only outlined. They are the keyboard path; the swipe
 * is a second way to do the same thing, never the only one. No arrow control
 * whose direction could be wrong in RTL, and no dots, because the 64px strip
 * is visible at 375px and already *is* the position indicator, with names.
 *
 * A product with a single image renders no strip at all: a one-item picker is
 * a control that cannot do anything.
 *
 * The call site passes `key={product.id}`. Without it React keeps this
 * component's tree position across a client-side navigation from one product
 * to another, and `active` survives onto a product whose gallery is a
 * different set of photos entirely.
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

    // 0.6 rather than a bare 0: two slides touch the viewport mid-swipe, and
    // the one that is mostly showing is the one that counts.
    const observer = new IntersectionObserver(
      (entries) => {
        // `intersectionRatio`, not `isIntersecting`: the latter is geometric
        // and true for *any* overlap, so a slide crossing the threshold
        // downward passes it too. A batch delivers every target that crossed
        // in the same pass, so on a fast flick the leaving slide could arrive
        // last and win — leaving `active` on the photo just scrolled away
        // from. Taking the widest-showing entry cannot pick a leaver.
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
    // Keyed on identity, not on `length`: swapping three photos for three
    // others changes every `<li>` key, so React destroys the observed nodes
    // and mounts new ones. Depending on the count alone would leave the
    // observer holding five dead nodes and watching none of the live ones,
    // with `active` frozen. `key={product.id}` at the call site makes that
    // unreachable today — which puts this effect's correctness in another
    // file, where the component cannot see it.
  }, [images]);

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
    // One owner for the restore, so a second tap inside the window cannot have
    // the first tap's timer fire mid-flight.
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
      // Belt and braces for engines this was not measured on. In Chrome,
      // restoring the property re-snaps on its own — measured, LTR and RTL,
      // smooth and instant — and this call changes nothing there. It is here
      // for WebKit, which is untested and which iOS Safari ships. If a
      // gallery is ever seen parked between two photos, suspect this line:
      // a scroll operation aborts an ongoing smooth scroll before it compares
      // targets, so on an engine that re-snaps smoothly it could cut short
      // the very re-snap it is insuring.
      track.scrollTo({ left: track.scrollLeft });
    };
    restore.current = resume;
    track.addEventListener('scrollend', resume);
    const timer = window.setTimeout(resume, SCROLL_SETTLE_MS);
  };

  // A finger on the track takes the gesture back, so snapping must be on for
  // it even if the jump it interrupts has not settled.
  const onTrackPointerDown = () => restore.current?.();

  // Unmount only — an `[images]` teardown would fire this mid-jump on any
  // re-render that changed the array identity, restoring snapping while the
  // scroll is still running and parking it a slide short.
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
        // `scrollbar-width` plus the webkit pseudo-element; there is no
        // `.scrollbar-hide` class in this project. The home page's snap
        // scroller hides its own with `scrollbar-width` alone, which still
        // paints a bar on pre-121 Chromium and on Safari — this is the fuller
        // pair, not a copy of that one.
        className="bg-secondary flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain scroll-smooth rounded-3xl [&::-webkit-scrollbar]:hidden"
        // Named for what actually fires. `data-umami-event` auto-tracks
        // clicks; it has no scroll or swipe binding, so a name promising a
        // swipe would have reported taps under it.
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
              // `preload`, not `priority`: the latter is deprecated in Next 16.
              // Nothing throws either way — the throws are `preload` or
              // `priority` paired with `loading="lazy"`, and the two of them
              // together — so this is a deprecation followed, not a defect
              // escaped.
              preload={index === 0}
              // Not lazy: a slide clipped by the `overflow-x` container does
              // not intersect the expanded lazy-load viewport, so `lazy` would
              // defer it until mid-swipe and pop it in. Eager, but at low
              // priority past the first — otherwise four photos nobody has
              // swiped to yet compete with the LCP image for the connection,
              // which on a 5-photo product is 300-750KB on a phone.
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
