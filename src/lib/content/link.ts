// The content link contract — what a destination saved under editable content
// may be, and where it goes. One client-safe module shared by the content schema
// (`site-content.ts` embeds `linkSchema` in each block that carries a link), the
// editor's picker, the save check in `src/logic/content/link-targets.ts`, and the
// storefront sections that render the links. Derive, never hand-mirror.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the picker
// is a client component, so this stays plain zod, like `site-content.ts`.
//
// Internal destinations are never admin-typed hrefs: a page is a name from a
// fixed list, and a category or product is stored by id and turned into today's
// slug at render (`resolveLink`), so a renamed slug never breaks a link and a
// free-text `javascript:` has nowhere to go. The one typed URL is an external
// link, and it must parse as an absolute `https:` URL without credentials.
import { z } from 'zod';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { boundedText } from '@/lib/validation/text';

/** The destination kinds. Never compare against bare strings. */
export const LINK_TYPES = {
  /** A fixed storefront page. */
  PAGE: 'page',
  /** The shop, optionally filtered by a category and a pet. */
  SHOP: 'shop',
  /** One product's page. */
  PRODUCT: 'product',
  /** An absolute `https:` URL, opened in a new tab. */
  EXTERNAL: 'external',
} as const;

export type LinkType = (typeof LINK_TYPES)[keyof typeof LINK_TYPES];

/** The pages a `page` link may name. */
export const LINK_PAGES = ['home', 'shop', 'about', 'account'] as const;
export type LinkPage = (typeof LINK_PAGES)[number];

const PAGE_PATHS: Record<LinkPage, string> = {
  home: PATHS.HOME,
  shop: PATHS.SHOP,
  about: PATHS.ABOUT,
  account: PATHS.ACCOUNT,
};

/** Persian, user-facing — surfaced on the content editor's link fields. */
export const LINK_MESSAGES = {
  type: 'نوع مقصد نامعتبر است.',
  page: 'صفحه مقصد نامعتبر است.',
  category: 'دسته‌بندی نامعتبر است.',
  pet: 'نوع حیوان نامعتبر است.',
  product: 'محصول نامعتبر است.',
  url: 'لینک بیرونی باید یک آدرس کامل با https باشد.',
  missingCategory: 'این دسته‌بندی وجود ندارد.',
  missingProduct: 'این محصول وجود ندارد یا غیرفعال است.',
  missingCard:
    'این محصول وجود ندارد، غیرفعال است یا زیرمجموعه‌ی محصول دیگری است.',
} as const;

/** The longest stored external href — checked on the href, the stored value. */
const MAX_URL_LENGTH = 500;

/**
 * The normalized href of an acceptable external URL, or `null`. It must parse as
 * an absolute URL (so `/shop` and `//evil.example` fail), with exactly the
 * `https:` scheme (not `http:`, `javascript:`, `data:`), a host and no
 * credentials. `URL` lower-cases the scheme and host and percent-encodes the
 * rest, so the href is ASCII and parses back to itself — which is what lets the
 * DAO re-parse a stored value on write and on read.
 */
function httpsHref(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const acceptable =
    url.protocol === 'https:' &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === '';
  return acceptable ? url.href : null;
}

// Capped twice: the typed text, then (through the pipe) the normalized href that
// is stored. Percent-encoding grows a Persian path six-fold, so a paste within the
// cap can still store too long — that gets the too-long message, not the https one.
const externalUrl = boundedText(MAX_URL_LENGTH)
  .refine((value) => httpsHref(value) !== null, { error: LINK_MESSAGES.url })
  .transform((value) => httpsHref(value) ?? value)
  .pipe(boundedText(MAX_URL_LENGTH));

/**
 * One saved destination. Fields a type does not declare are stripped, so a
 * `page` link carrying a smuggled `url` stores and renders as the page.
 */
export const linkSchema = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal(LINK_TYPES.PAGE),
      page: z.enum(LINK_PAGES, { error: LINK_MESSAGES.page }),
    }),
    z.object({
      type: z.literal(LINK_TYPES.SHOP),
      categoryId: z.uuid(LINK_MESSAGES.category).optional(),
      pet: z
        .enum([PET_TYPES.CAT, PET_TYPES.DOG], { error: LINK_MESSAGES.pet })
        .optional(),
    }),
    z.object({
      type: z.literal(LINK_TYPES.PRODUCT),
      productId: z.uuid(LINK_MESSAGES.product),
    }),
    z.object({ type: z.literal(LINK_TYPES.EXTERNAL), url: externalUrl }),
  ],
  { error: LINK_MESSAGES.type },
);

export type Link = z.infer<typeof linkSchema>;

/**
 * Today's slugs for the ids links store: every category, and each referenced
 * product that is still active (a hidden or deleted one is absent). Plain
 * objects, not Maps, so a server component can pass them to a client section.
 * Loaded by `loadLinkTargets`.
 */
export type LinkTargets = {
  categories: Record<string, string>;
  products: Record<string, string>;
};

/** Where a link goes, and whether it leaves the site (new tab, `noopener`). */
type ResolvedLink = { href: string; external: boolean };

/**
 * Where a saved link goes right now. Pure (the catalog lookups arrive in
 * `targets`), and it never dead-ends:
 *   · no link saved               → `fallback`, the destination the code had
 *                                   before links were editable
 *   · a category deleted since    → the shop, still filtered by the pet
 *   · a product hidden or deleted → the shop
 */
export function resolveLink(
  link: Link | null | undefined,
  fallback: string,
  targets: LinkTargets,
): ResolvedLink {
  if (!link) return { href: fallback, external: false };
  switch (link.type) {
    case LINK_TYPES.PAGE:
      return { href: PAGE_PATHS[link.page], external: false };
    case LINK_TYPES.SHOP: {
      const category = link.categoryId
        ? targets.categories[link.categoryId]
        : undefined;
      return { href: shopPath({ category, pet: link.pet }), external: false };
    }
    case LINK_TYPES.PRODUCT: {
      const slug: string | undefined = targets.products[link.productId];
      return { href: slug ? productPath(slug) : PATHS.SHOP, external: false };
    }
    case LINK_TYPES.EXTERNAL:
      return { href: link.url, external: true };
  }
}

/**
 * A catalog id a content value references, at the field path it sits on. A
 * `product` is a link target — any active product, a family member's own page
 * included. A `card` is a product the shop lists as a card — active and never a
 * member — which is what a «انتخاب‌های اسموکی» box shows; it is not a link, so
 * `loadLinkTargets` never resolves it.
 */
type LinkRef = {
  path: string;
  kind: 'category' | 'product' | 'card';
  id: string;
};

/**
 * The fields that store a list of bare ids rather than links — a routine tab's
 * categories, the «انتخاب‌های اسموکی» boxes (whose `null` entries are «خودکار»)
 * — and what each id names.
 */
const ID_LISTS = new Map<string, LinkRef['kind']>([
  ['categoryIds', 'category'],
  ['productIds', 'card'],
]);

/**
 * Every category and product id in a parsed content value, with its dotted field
 * path (`cards.2.link`, `slots.0.categoryIds`, `productIds`) — a zod issue path's
 * shape, so a save-side error lands on the editor field holding the link. It
 * walks the whole value instead of a per-key list, so a link field added to a
 * block later is covered without touching this.
 */
export function collectLinkRefs(
  value: unknown,
  path: readonly string[] = [],
): LinkRef[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectLinkRefs(item, [...path, String(index)]),
    );
  }
  if (typeof value !== 'object' || value === null) return [];

  const node = value as Record<string, unknown>;
  if (node.type === LINK_TYPES.SHOP && typeof node.categoryId === 'string') {
    return [{ path: path.join('.'), kind: 'category', id: node.categoryId }];
  }
  if (node.type === LINK_TYPES.PRODUCT && typeof node.productId === 'string') {
    return [{ path: path.join('.'), kind: 'product', id: node.productId }];
  }
  return Object.entries(node).flatMap(([key, child]) => {
    const kind = ID_LISTS.get(key);
    return kind && Array.isArray(child)
      ? child
          .filter((id): id is string => typeof id === 'string')
          .map((id) => ({ path: [...path, key].join('.'), kind, id }))
      : collectLinkRefs(child, [...path, key]);
  });
}
