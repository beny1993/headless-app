import Image from 'next/image';
import type { ContentValue } from '@/lib/content/site-content';
import { imageSrc } from '@/lib/storage/image-url';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';
import { knownShelfPath } from './content';

/**
 * «راهنمای اسموکی» — an editorial block above the fold of the lower page.
 *
 * The magazine it originally linked to is parked on the backlog, so the CTA
 * points at the products the text is actually about (wet food, for a cat that
 * does not drink enough) rather than shipping a dead article route — the
 * design review's port note on the magazine. The CTA's label and destination
 * (unset: wet food), and the eyebrow, headline, body and image, are admin
 * content, rendered as plain text.
 *
 * The eyebrow uses `accent-on-dark`, not `accent`: on `--ink-soft` the brand
 * terracotta measures 3.29:1 and fails AA.
 */
export function FeaturedStorySection({
  content,
  targets,
  categorySlugs,
}: {
  content: ContentValue<'home.guide'>;
  targets: LinkTargets;
  /** Every category the catalogue has, so the code fallback names one. */
  categorySlugs: readonly string[];
}) {
  return (
    <section className="bg-ink py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="grid grid-cols-1 overflow-hidden rounded-3xl lg:grid-cols-2">
          <div className="relative h-80 lg:h-auto">
            <Image
              src={imageSrc(content.image.key)}
              alt={content.image.alt}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="bg-ink-soft flex flex-col justify-center p-10 lg:p-14">
            <span className="text-accent-on-dark mb-4 text-sm font-medium tracking-wide">
              {content.eyebrow}
            </span>
            <h2 className="mb-5 text-3xl leading-tight font-black whitespace-pre-line text-white lg:text-4xl">
              {content.headline}
            </h2>
            <p className="mb-8 leading-relaxed whitespace-pre-line text-white/70">
              {content.body}
            </p>
            <ContentLink
              {...resolveLink(
                content.ctaLink,
                knownShelfPath({ category: 'wet-food' }, categorySlugs),
                targets,
              )}
              className="bg-brand hover:bg-brand-hover text-brand-foreground self-start rounded-xl px-6 py-3 font-bold transition-colors"
              data-umami-event="home-story-shop-click"
            >
              {content.cta}
            </ContentLink>
          </div>
        </div>
      </div>
    </section>
  );
}
