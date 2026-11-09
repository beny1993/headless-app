import { PATHS } from '@/lib/constant/paths';

/**
 * The storefront chrome's code-side link *targets* — where the header nav and the
 * footer columns point when no destination is saved for a label
 * (`header.navLinks` / `footer.columns[c].linkTargets`, resolved with
 * `resolveLink` in the components). Every row saved before destinations became
 * content has none, so these keep those links exactly where they were.
 *
 * The component zips a label tuple with the same-index target tuple; a unit test
 * asserts the lengths match (`DEFAULT_CONTENT.header.nav.length === NAV_TARGETS.length`,
 * and the two footer columns likewise), and `block-fields.ts` gives each destination picker its
 * entry here as the fallback it previews — so the editor always shows where an
 * unsaved destination really goes.
 *
 * Both live here (not in `footer.tsx`) so this module stays pure and client-safe:
 * `block-fields.ts` is admin-client code and imports these, and must not drag the
 * `Footer` server component into its bundle.
 *
 * The design's magazine link is deliberately absent: no magazine exists and no
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
