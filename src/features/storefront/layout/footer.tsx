import Image from 'next/image';
import { Instagram, Send } from 'lucide-react';
import { FOOTER_TARGETS } from './nav-links';
import {
  instagramUrl,
  telegramUrl,
  type ContentValue,
} from '@/lib/content/site-content';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';
import { formatJalaliYear } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Storefront footer, ported from the prototype.
 *
 * The brand, tagline, column titles, link labels, copyright sentence and credit
 * line are admin content (`footer`), and so is where each link goes: label l of
 * column c goes to its saved `linkTargets[l]`, else to `FOOTER_TARGETS[c][l]`. The `© {jalali year}` prefix and the year itself are rendered in code
 * (`formatJalaliYear`), never stored: the stored `copyright` is only the text
 * after them.
 *
 * Trimmed to links with real destinations (the design review's "no dead
 * navigation"): the prototype's «پشتیبانی» column and the «ارسال رایگان» /
 * «ضمانت کیفیت» entries have no pages, so there are two link columns, not three.
 *
 * Compact by design (Benyamin, 2026-09-28 — it had grown taller than a phone
 * screen): the header's small mark beside the wordmark, not the 176px badge
 * (which stays the OG image in `seo.ts`); the brand block and the link columns
 * share one row from `md`; a column of more than three links folds into columns
 * of three. The top hairline parts it from a dark section right above it — the
 * home page's closing statement is the same `bg-ink`.
 *
 * The social pills sit under the tagline. Persian labels, not handles — two
 * Instagram accounts need telling apart, and «dailies» says nothing to a Persian
 * shopper. 40px tall: slimmer than the old 44px, still well over the 24px
 * touch-target minimum. A pill renders only while its handle (`footer.social`)
 * is set; the row goes with the last one.
 */
const SOCIAL_PILL =
  'hover:border-accent-on-dark/50 hover:text-accent-on-dark inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-sm transition-colors';

export function Footer({
  content,
  targets,
}: {
  content: ContentValue<'footer'>;
  targets: LinkTargets;
}) {
  const socials = [
    {
      handle: content.social.instagram,
      url: instagramUrl,
      label: 'اینستاگرام فروشگاه',
      Icon: Instagram,
      event: 'footer-social-instagram-shop',
    },
    {
      handle: content.social.instagramDailies,
      url: instagramUrl,
      label: 'اینستاگرام آموزش و سرگرمی',
      Icon: Instagram,
      event: 'footer-social-instagram-dailies',
    },
    {
      handle: content.social.telegram,
      url: telegramUrl,
      label: 'تلگرام',
      Icon: Send,
      event: 'footer-social-telegram',
    },
  ].filter((social) => social.handle !== '');

  const columns = content.columns.map((column, c) => ({
    title: column.title,
    links: column.links.map((label, l) => ({
      label,
      ...resolveLink(column.linkTargets?.[l], FOOTER_TARGETS[c][l], targets),
    })),
  }));

  return (
    <footer className="bg-ink border-t border-white/10 text-white/70">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="md:max-w-lg">
            <div className="flex items-center gap-2.5">
              <Image
                src="/brand/smokey-mark.png"
                width={40}
                height={40}
                alt={`لوگوی ${content.brand}، فروشگاه حیوانات خانگی`}
                className="size-10 shrink-0"
              />
              <p
                aria-hidden="true"
                className="text-xl font-black tracking-tight text-white"
              >
                {content.brand}
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">
              {content.tagline}
            </p>
            {socials.length > 0 && (
              <ul
                aria-label="شبکه‌های اجتماعی"
                className="mt-4 flex flex-wrap gap-2"
              >
                {socials.map(({ handle, url, label, Icon, event }) => (
                  <li key={event} className="max-w-full">
                    <ContentLink
                      href={url(handle)}
                      external
                      className={SOCIAL_PILL}
                      data-umami-event={event}
                    >
                      <Icon size={16} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{label}</span>
                    </ContentLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-12 sm:gap-16">
            {columns.map((column, c) => (
              // Index key: column titles are content and may repeat.
              <div key={c}>
                <p className="mb-2 text-sm font-bold text-white">
                  {column.title}
                </p>
                <ul
                  className={cn(
                    'grid gap-x-8',
                    column.links.length > 3 && 'grid-flow-col grid-rows-3',
                  )}
                >
                  {column.links.map((link, l) => (
                    <li key={l}>
                      <ContentLink
                        href={link.href}
                        external={link.external}
                        className="hover:text-accent-on-dark inline-block py-1 text-sm transition-colors"
                        data-umami-event="footer-link-click"
                      >
                        {link.label}
                      </ContentLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs sm:flex-row">
          <p>
            © {formatJalaliYear()} {content.copyright}
          </p>
          <p className="whitespace-pre-line">{content.credit}</p>
        </div>
      </div>
    </footer>
  );
}
