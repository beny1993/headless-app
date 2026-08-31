import Image from 'next/image';
import { COMMUNITY_PETS } from './content';

/**
 * «خانواده اسموکی» — a static photo wall, by the story's own acceptance
 * criteria (there is no community feature behind it).
 *
 * Two design-review findings shape it: the captions are always visible rather
 * than hover-only (a hover caption is unreachable on touch), and each tile is
 * a `<figure>` that links nowhere — a card that looks clickable but is not was
 * the thing being objected to, so it is not dressed as one.
 */
export function CommunitySection() {
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
          {COMMUNITY_PETS.map((pet) => (
            <figure
              key={pet.name}
              className={`group relative overflow-hidden rounded-2xl ${
                pet.tall ? 'row-span-2' : ''
              }`}
            >
              <Image
                src={pet.image}
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
                <p className="mt-0.5 text-xs text-white/90">«{pet.quote}»</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
