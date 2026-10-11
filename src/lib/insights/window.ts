import { z } from 'zod';

/**
 * The windows the admin insights page offers, in days back from now. A closed
 * set rather than any number: each one is a cached Umami query, and a free
 * `?days=` would let a crafted URL mint a fresh one per request.
 */
export const INSIGHT_WINDOW_DAYS = [7, 30, 90] as const;
export type InsightWindowDays = (typeof INSIGHT_WINDOW_DAYS)[number];
export const DEFAULT_INSIGHT_WINDOW: InsightWindowDays = 30;

/**
 * `?days=` as the page reads it: one of the windows, anything else (missing,
 * `abc`, `31`, `7.5`, a repeated param) degrading to the default.
 */
export const insightWindowSchema = z.coerce
  .number()
  .pipe(z.literal(INSIGHT_WINDOW_DAYS))
  .catch(DEFAULT_INSIGHT_WINDOW);
