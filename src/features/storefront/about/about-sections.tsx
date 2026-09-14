import Image from 'next/image';
import { Award, Check, Heart, Shield } from 'lucide-react';
import type { ContentValue } from '@/lib/content/site-content';
import { imageSrc } from '@/lib/storage/image-url';
import { shopPath } from '@/lib/constant/paths';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';
import { toPersianDigits } from '@/lib/format';

/**
 * The about page's sections, ported from the prototype's `AboutPage`
 * (`design/src/app/App.tsx`).
 *
 * The editorial copy and photos are admin content (`site_content`) passed in as
 * typed props — rendered as plain text nodes, with headline line breaks from
 * `whitespace-pre-line` and the break before an accent line as a code `<br />`.
 * What stays in code is structure, not content: the section order, the CTA
 * button's fallback destination (used until the admin saves a `ctaLink`), and
 * the value cards' icons — the four `lucide` icons below, matched to the four
 * value items by position.
 */

/** The value-card icons, in page order — matched to `about.values.items` by index. */
const VALUE_ICONS = [Award, Shield, Heart, Check] as const;

/**
 * The hero.
 *
 * `min-h-[70vh]` where the prototype has a fixed `h-[70vh]`. Measured, the
 * hero's content is 279px at 375px wide, so a fixed 70vh only starts clipping
 * under `overflow-hidden` below a ~400px-tall viewport — no phone in portrait.
 * `min-h` is kept anyway because it costs nothing and the copy here is the kind
 * that grows. The prototype's own `pt-20` is gone — the storefront layout
 * already offsets the fixed navbar.
 *
 * White text lands on `--ink` with the photo at 40% plus a gradient, which is
 * what keeps the copy at a predictable contrast ratio instead of floating over
 * an unpredictable photograph.
 */
function AboutHero({ content }: { content: ContentValue<'about.hero'> }) {
  return (
    <section className="bg-ink relative flex min-h-[70vh] items-center overflow-hidden">
      <Image
        src={imageSrc(content.image.key)}
        alt={content.image.alt}
        fill
        // Above the fold and full-bleed: the page's LCP element.
        priority
        sizes="100vw"
        className="object-cover opacity-40"
      />
      <div className="from-ink absolute inset-0 bg-gradient-to-l to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
        <p className="text-accent-on-dark mb-4 text-sm font-medium tracking-wide">
          {content.eyebrow}
        </p>
        <h1
          className="font-black whitespace-pre-line text-white"
          style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', lineHeight: 1.2 }}
        >
          {content.headline}
          <br />
          <span className="text-accent-on-dark">{content.accent}</span>
        </h1>
      </div>
    </section>
  );
}

function AboutStory({ content }: { content: ContentValue<'about.story'> }) {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <div className="relative h-96 overflow-hidden rounded-3xl">
            <Image
              src={imageSrc(content.image.key)}
              alt={content.image.alt}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <h2 className="mb-6 text-3xl font-black">{content.title}</h2>
            {content.paragraphs.map((paragraph, index) => (
              <p
                // Index key: the paragraphs are editable content and may repeat.
                key={index}
                className={`text-muted-foreground leading-relaxed whitespace-pre-line ${
                  index < content.paragraphs.length - 1 ? 'mb-4' : ''
                }`}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutProcess({ content }: { content: ContentValue<'about.process'> }) {
  return (
    <section className="bg-secondary/30 py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-black">{content.title}</h2>
        </div>
        <ol className="relative flex flex-col gap-6 md:flex-row">
          {content.steps.map((item, index) => (
            <li key={index} className="relative flex-1 text-center">
              <div className="bg-accent-strong mx-auto mb-4 flex size-12 items-center justify-center rounded-full text-lg font-black text-white">
                {toPersianDigits(index + 1)}
              </div>
              <h3 className="mb-2 text-lg font-bold">{item.step}</h3>
              <p className="text-muted-foreground text-sm whitespace-pre-line">
                {item.desc}
              </p>
              {index < content.steps.length - 1 && (
                // The connector runs the full width of the row, so it is
                // direction-neutral decoration — physical placement is fine
                // here (design review, finding 9).
                <div
                  className="bg-border absolute top-6 left-0 -z-10 hidden h-0.5 w-full md:block"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AboutValues({ content }: { content: ContentValue<'about.values'> }) {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-black">{content.title}</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {content.items.map((value, index) => {
            const Icon = VALUE_ICONS[index] ?? VALUE_ICONS[0];
            return (
              <div
                key={index}
                className="bg-card border-border rounded-2xl border p-7"
              >
                <div className="bg-accent/10 text-accent-strong mb-4 flex size-12 items-center justify-center rounded-xl">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-lg font-bold">{value.title}</h3>
                <p className="text-muted-foreground whitespace-pre-line">
                  {value.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * The closing call to action. The headline, the button label and where the
 * button goes (unset: the shop) are admin content.
 *
 * This is the only interactive element in the app that sits on an
 * `--accent-strong` surface, and the global focus ring is `--ring` (#C9623F) —
 * 1.26:1 against that fill, i.e. invisible, failing WCAG 2.2 SC 1.4.11. The
 * outline is white here (4.99:1) instead; every other button in the app is on
 * a light or `--ink` surface where the default ring still measures fine.
 */
function AboutCta({
  content,
  targets,
}: {
  content: ContentValue<'about.cta'>;
  targets: LinkTargets;
}) {
  return (
    <section className="bg-accent-strong px-4 py-24 text-center">
      <h2 className="mb-4 text-4xl font-black whitespace-pre-line text-white">
        {content.headline}
      </h2>
      <ContentLink
        {...resolveLink(content.ctaLink, shopPath(), targets)}
        className="text-accent-strong mt-4 inline-block rounded-xl bg-white px-8 py-4 font-bold transition-colors hover:bg-white/90 focus-visible:outline-white"
        data-umami-event="about-cta-shop-click"
      >
        {content.cta}
      </ContentLink>
    </section>
  );
}

export { AboutHero, AboutStory, AboutProcess, AboutValues, AboutCta };
