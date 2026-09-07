import Image from 'next/image';
import type { ContentValue } from '@/lib/content/site-content';
import { imageSrc } from '@/lib/storage/image-url';

/**
 * «خانواده اسموکی» — a static photo wall, by the story's own acceptance
 * criteria (there is no community feature behind it).
 *
 * Five positional slots, admin content (photo, name, owner, quote); the count,
 * the `tall` mosaic layout (the first and fourth tiles — indices 0 and 3 — run
 * tall), the section heading and the eyebrow all stay in code — they are layout,
 * not content. Each slot's alt text
 * is derived in code from its name and owner, so a swapped photo cannot carry a
 * stale alt.
 *
 * Two design-review findings shape it: the captions are always visible rather
 * than hover-only (a hover caption is unreachable on touch), and each tile is
 * a `<figure>` that links nowhere — a card that looks clickable but is not was
 * the thing being objected to, so it is not dressed as one.
 */
export function CommunitySection({
  content,
}: {
  content: ContentValue<'home.family'>;
}) {
  return (
    <section className="bg-secondary/30 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <span className="text-accent-strong mb-3 inline-block text-sm font-medium">
            داستان‌های واقعی
          </span>
          <h2 className="text-4xl font-black">خانواده اسموکی</h2>
        </div>

        <div className="grid auto-rows-[180px] grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {content.slots.map((pet, index) => (
            <figure
              // Index key, not the name: names are editable content and may repeat.
              key={index}
              className={`group relative overflow-hidden rounded-2xl ${
                // The two portraits that run tall in the mosaic — layout, in code.
                index === 0 || index === 3 ? 'row-span-2' : ''
              }`}
            >
              <Image
                src={imageSrc(pet.image)}
                alt={`${pet.name}، حیوان خانگی ${pet.owner}`}
                fill
                sizes="(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw"
                className="object-cover transition-transform duration-500 group-hover:scale-110"
              />
              {/* Permanent scrim: the caption below sits on the photo and
                  needs a predictable background to stay legible. */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <figcaption className="absolute inset-x-3 bottom-3">
                <p className="font-bold text-white">{pet.name}</p>
                <p className="mt-0.5 text-xs whitespace-pre-line text-white/90">
                  «{pet.quote}»
                </p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
