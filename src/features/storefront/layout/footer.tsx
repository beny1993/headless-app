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
 * «ضمانت کیفیت» entries have no pages, so the grid is three columns, not four.
 *
 * The social pills sit under the tagline, not in a fourth column: at `md` a
 * four-column brand cell is 152px and the logo is a fixed 176px. Persian
 * labels, not handles — two Instagram accounts need telling apart, and
 * «dailies» says nothing to a Persian shopper. A pill renders only while its
 * handle (`footer.social`) is set; the row goes with the last one.
 */
const SOCIAL_PILL =
  'hover:border-accent-on-dark/50 hover:text-accent-on-dark inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-sm transition-colors';

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
    <footer className="bg-ink text-white/70">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <Image
              src="/brand/smokey-logo-primary.png"
              width={176}
              height={146}
              alt={`لوگوی ${content.brand}، فروشگاه حیوانات خانگی`}
              className="mb-4 h-auto w-44"
            />
            <p
              aria-hidden="true"
              className="mb-3 text-2xl font-black text-white"
            >
              {content.brand}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">
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
          {columns.map((column, c) => (
            // Index key: column titles are content and may repeat.
            <div key={c}>
              <p className="mb-4 font-bold text-white">{column.title}</p>
              <ul className="space-y-2">
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
        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-sm">
            © {formatJalaliYear()} {content.copyright}
          </p>
          <p className="text-xs whitespace-pre-line">{content.credit}</p>
        </div>
      </div>
    </footer>
  );
}
