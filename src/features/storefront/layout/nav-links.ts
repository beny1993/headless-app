import { PATHS } from '@/lib/constant/paths';

/**
 * The storefront chrome's link *targets* — the fixed destinations the header nav
 * and the footer columns point at. Under the v2 CMS rule, a link's LABEL is
 * editable content (it lives in `header.nav` / `footer.columns[c].links`), but
 * its TARGET stays in code and travels with the layout: an editable label over a
 * fixed target is exactly how «مشاهده غذای خشک» could be made to land on wet food.
 *
 * The component zips a label tuple with the same-index target tuple; a unit test
 * asserts the lengths match (`DEFAULT_CONTENT.header.nav.length === NAV_TARGETS.length`,
 * and the two footer columns likewise), and `block-fields.ts` builds each label
 * field's read-only «مقصد» hint from these arrays — so the editor always shows an
 * editable label's real destination.
 *
 * Both live here (not in `footer.tsx`) so this module stays pure and client-safe:
 * `block-fields.ts` is admin-client code and imports these, and must not drag the
 * `Footer` server component into its bundle.
 *
 * «مجله اسموکی» from the design is deliberately absent: no magazine exists and no
 * story plans one, so it would ship as dead navigation (design review).
 */
export const NAV_TARGETS = [PATHS.HOME, PATHS.SHOP, PATHS.ABOUT] as const;

/**
 * The footer's two columns of link targets. Column one is five shop entries (they
 * all point at the bare shop for now — [[Story - Shop Listing Page]] defines the
 * filter query contract and can deep-link them later, one line each); column two
 * is the single «درباره ما» link.
 */
export const FOOTER_TARGETS = [
  [PATHS.SHOP, PATHS.SHOP, PATHS.SHOP, PATHS.SHOP, PATHS.SHOP],
  [PATHS.ABOUT],
] as const;
