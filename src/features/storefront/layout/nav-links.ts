import { PATHS } from '@/lib/constant/paths';

/**
 * The storefront's primary navigation, shared by the desktop bar and the mobile
 * menu so the two can never drift.
 *
 * «مجله اسموکی» from the design is deliberately absent: no magazine exists and
 * no story plans one, so it would ship as dead navigation (design review).
 */
export const NAV_LINKS = [
  { label: 'خانه', href: PATHS.HOME },
  { label: 'فروشگاه', href: PATHS.SHOP },
  { label: 'درباره ما', href: PATHS.ABOUT },
] as const;
