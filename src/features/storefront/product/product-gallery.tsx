'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/** One image as the product page reads it — a storage key, not a URL. */
export type GalleryImage = { id: string; objectKey: string };

/**
 * The product gallery: one large image, and thumbnails when there is more than
 * one to choose from.
 *
 * The thumbnails are real buttons carrying `aria-pressed`, not the design
 * review's clickable `<div>`s (finding 2) — keyboard reachable, and the
 * selected one is announced rather than only outlined. Nothing here is
 * direction-sensitive: the strip is a flex row, so RTL lays it out from the
 * right on its own and there is no arrow control whose direction could be
 * wrong (finding 9's carousel bug). The 64px thumbs clear the 40px touch-target
 * floor (finding 6).
 *
 * A product with a single image renders no strip at all: a one-item picker is
 * a control that cannot do anything. Every seeded product has exactly one image
 * today, so that is the common case, not the edge one.
 */
export function ProductGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  // Defensive rather than decorative: `active` is only ever set from this
  // list, but a shorter list arriving on a client navigation between two
  // product pages would otherwise index past its end.
  const current = images[active] ?? images[0];

  return (
    <div className="space-y-4">
      <div className="bg-secondary relative aspect-square overflow-hidden rounded-3xl">
        {current ? (
          <Image
            // A storage key, not a URL: `imageSrc` resolves it — bundled
            // `products/…` from public/, an `uploads/…` object from the bucket.
            src={imageSrc(current.objectKey)}
            // Described, unlike the card's decorative thumbnail: here the image
            // is the subject of the page, and it is the only place a
            // non-sighted visitor learns one exists at all.
            alt={title}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ShoppingBag
              size={48}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
      </div>

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
              onClick={() => setActive(index)}
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
