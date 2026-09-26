import type { ContentValue } from '@/lib/content/site-content';
import { PATHS } from '@/lib/constant/paths';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';

/**
 * The closing statement. The eyebrow, headline, accent line, body and link label
 * are admin content (plain text; the break before the accent line is a code
 * `<br />`), and so is where the link goes (unset: /about). The eyebrow is
 * `white/60`, not `white/40`, which is 3.72:1 on `--ink` and fails AA.
 */
export function PhilosophySection({
  content,
  targets,
}: {
  content: ContentValue<'home.philosophy'>;
  targets: LinkTargets;
}) {
  return (
    <section className="bg-ink py-24">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-8">
        <p className="mb-6 text-sm font-medium tracking-widest text-white/60">
          {content.eyebrow}
        </p>
        <h2
          className="mb-6 font-black whitespace-pre-line text-white"
          style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
        >
          {content.headline}
          <br />
          <span className="text-accent-on-dark">{content.accent}</span>
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-white/60">
          {content.body}
        </p>
        <ContentLink
          {...resolveLink(content.ctaLink, PATHS.ABOUT, targets)}
          className="text-accent-on-dark border-accent-on-dark hover:text-accent-on-dark/80 border-b pb-0.5 font-medium transition-colors"
          data-umami-event="home-philosophy-about-click"
        >
          {content.cta}
        </ContentLink>
      </div>
    </section>
  );
}
