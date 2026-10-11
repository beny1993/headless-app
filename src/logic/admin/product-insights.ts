// The admin «پرطرفدارها» page: what shoppers bought (our orders) beside what
// they looked at (Umami's pageviews), per product, per category and per pet.
//
// Two sources, deliberately unequal:
//   · Sales are ours and exact: `OrderDao.salesByProductSince`, under the
//     dashboard's revenue rule (a booked status AND a settled payment).
//   · Views are Umami's and approximate: ad blockers hide part of the traffic.
//     Umami may also be off (local, staging) or down. Either way the page
//     renders: views become `null` and the sales stand alone.
//
// `buildProductInsights` is pure, so every rule below is unit-tested without a
// database or a network; `loadProductInsights` is only the wiring.
import { OrderDao, type ProductSalesRow } from '@/db/dao/OrderDao';
import { ProductDao, type ProductInsightRow } from '@/db/dao/ProductDao';
import {
  PET_LABELS,
  PET_TYPE_VALUES,
  type PetType,
} from '@/lib/catalog/product-query';
import { displayTitle } from '@/lib/catalog/variant';
import { PATHS } from '@/lib/constant/paths';
import type { InsightWindowDays } from '@/lib/insights/window';
import { readUmamiMetric, type UmamiResult } from '@/lib/umami/client';

/** Rows in each short action list. */
export const ACTION_LIST_SIZE = 5;
/** Rows in the product table; the rest of a long tail adds nothing to read. */
export const PRODUCT_TABLE_SIZE = 50;
/** Rows in the traffic-source list. */
export const SOURCE_LIST_SIZE = 8;

/** Whether the view numbers exist, and if not, why — the page words each. */
export type ViewsStatus = UmamiResult['status'];

/** The numbers every row carries. `views` is `null` when Umami gave none. */
export type InsightNumbers = {
  units: number;
  /** Integer Toman. */
  revenue: number;
  /** Distinct revenue orders — the conversion rate's numerator. */
  orders: number;
  views: number | null;
};

export type ProductInsight = InsightNumbers & {
  id: string;
  slug: string;
  /** `displayTitle`, the same wording the admin product list uses. */
  title: string;
  /** «والد › زیردسته», or the category alone when it is top-level. */
  category: string;
  stock: number;
  isActive: boolean;
};

export type GroupInsight = InsightNumbers & { key: string; label: string };

export type TrafficSource = { label: string; visits: number };

export type ProductInsights = {
  viewsStatus: ViewsStatus;
  totals: InsightNumbers;
  /** Most sold first, then most viewed; at most `PRODUCT_TABLE_SIZE`. */
  products: ProductInsight[];
  categories: GroupInsight[];
  pets: GroupInsight[];
  /** Viewed, nothing sold — most viewed first. Empty without views. */
  seenNotSold: ProductInsight[];
  /** Active, stock 0, viewed — most viewed first. Empty without views. */
  soldOutWanted: ProductInsight[];
  /** Visits per source, most first; `null` without Umami. */
  sources: TrafficSource[] | null;
};

const PRODUCT_PREFIX = `${PATHS.PRODUCT}/`;

/**
 * The slug a tracked path names, or `null` when it is not a product page.
 * Tolerates what a real URL carries: a query, a fragment, a trailing slash and
 * percent-encoding (`productPath` encodes the slug). Anything deeper than one
 * segment, empty, or undecodable is not a product page.
 */
export const productSlugOfPath = (path: string): string | null => {
  const bare = path.split(/[?#]/, 1)[0]!;
  if (!bare.startsWith(PRODUCT_PREFIX)) return null;
  const segment = bare.slice(PRODUCT_PREFIX.length).replace(/\/$/, '');
  if (!segment || segment.includes('/')) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * Referrer domains folded into the sources a shop owner recognizes: every
 * Instagram host (`l.instagram.com` is its link shim) is one «اینستاگرام»,
 * every Google ccTLD one «گوگل». Anything else stays its bare domain, `www.`
 * dropped.
 */
const SOURCE_FAMILIES: { label: string; test: RegExp }[] = [
  { label: 'اینستاگرام', test: /(^|\.)instagram\.com$/ },
  { label: 'گوگل', test: /(^|\.)google\.(com|co|com?\.[a-z]{2}|[a-z]{2})$/ },
  { label: 'تلگرام', test: /(^|\.)(t\.me|telegram\.org|telegram\.me)$/ },
  { label: 'بینگ', test: /(^|\.)bing\.com$/ },
  { label: 'یاهو', test: /(^|\.)yahoo\.com$/ },
  { label: 'واتس‌اپ', test: /(^|\.)whatsapp\.com$/ },
];

export const sourceLabel = (domain: string): string => {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  return SOURCE_FAMILIES.find(({ test }) => test.test(host))?.label ?? host;
};

const zeroNumbers = (withViews: boolean): InsightNumbers => ({
  units: 0,
  revenue: 0,
  orders: 0,
  views: withViews ? 0 : null,
});

const addInto = (target: InsightNumbers, source: InsightNumbers) => {
  target.units += source.units;
  target.revenue += source.revenue;
  target.orders += source.orders;
  if (target.views !== null && source.views !== null) {
    target.views += source.views;
  }
};

/** Sold first, then viewed, then revenue. */
const byInterest = (a: InsightNumbers, b: InsightNumbers) =>
  b.units - a.units || (b.views ?? 0) - (a.views ?? 0) || b.revenue - a.revenue;

const byViews = (a: ProductInsight, b: ProductInsight) =>
  (b.views ?? 0) - (a.views ?? 0) || a.title.localeCompare(b.title, 'fa');

const categoryLabel = (row: ProductInsightRow) =>
  row.parentCategoryTitle
    ? `${row.parentCategoryTitle} › ${row.categoryTitle}`
    : row.categoryTitle;

/**
 * Joins sales, pageviews and product facts into the page's rows.
 *
 * A product is in the report if it sold or was viewed in the window. A sale
 * whose product row is missing cannot happen (`order_items` restricts the
 * delete); a viewed slug with no product (renamed, deleted) is dropped, since
 * there is nothing to show it under.
 */
export const buildProductInsights = ({
  sales,
  products,
  pageViews,
  referrers,
}: {
  sales: readonly ProductSalesRow[];
  products: readonly ProductInsightRow[];
  pageViews: UmamiResult;
  referrers: UmamiResult;
}): ProductInsights => {
  const withViews = pageViews.status === 'ok';

  const viewsBySlug = new Map<string, number>();
  if (pageViews.status === 'ok') {
    for (const { key, count } of pageViews.rows) {
      const slug = productSlugOfPath(key);
      if (slug) viewsBySlug.set(slug, (viewsBySlug.get(slug) ?? 0) + count);
    }
  }
  const salesById = new Map(sales.map((row) => [row.productId, row]));

  const productInsights: ProductInsight[] = [];
  const categories = new Map<string, GroupInsight>();
  const pets = new Map<PetType, GroupInsight>();
  const totals = zeroNumbers(withViews);

  for (const row of products) {
    const sold = salesById.get(row.id);
    const views = withViews ? (viewsBySlug.get(row.slug) ?? 0) : null;
    if (!sold && !views) continue;

    const numbers: InsightNumbers = {
      units: sold?.units ?? 0,
      revenue: sold?.revenue ?? 0,
      orders: sold?.orders ?? 0,
      views,
    };
    const category = categoryLabel(row);
    productInsights.push({
      ...numbers,
      id: row.id,
      slug: row.slug,
      title: displayTitle(row),
      category,
      stock: row.stock,
      isActive: row.isActive,
    });
    addInto(totals, numbers);

    const group = categories.get(row.categoryId) ?? {
      ...zeroNumbers(withViews),
      key: row.categoryId,
      label: category,
    };
    addInto(group, numbers);
    categories.set(row.categoryId, group);

    // A both-pets product counts under each: the question is «what do cat
    // owners buy», and it is an answer to both. So the pet rows can add up
    // to more than the totals.
    for (const pet of row.petTypes) {
      const petGroup = pets.get(pet) ?? {
        ...zeroNumbers(withViews),
        key: pet,
        label: PET_LABELS[pet],
      };
      addInto(petGroup, numbers);
      pets.set(pet, petGroup);
    }
  }

  const viewed = (product: ProductInsight) => (product.views ?? 0) > 0;

  return {
    viewsStatus: pageViews.status,
    totals,
    products: [...productInsights]
      .sort((a, b) => byInterest(a, b) || a.title.localeCompare(b.title, 'fa'))
      .slice(0, PRODUCT_TABLE_SIZE),
    categories: [...categories.values()].sort(
      (a, b) => byInterest(a, b) || a.label.localeCompare(b.label, 'fa'),
    ),
    pets: PET_TYPE_VALUES.flatMap((pet) => pets.get(pet) ?? []),
    seenNotSold: productInsights
      .filter((product) => viewed(product) && product.units === 0)
      .sort(byViews)
      .slice(0, ACTION_LIST_SIZE),
    soldOutWanted: productInsights
      .filter(
        (product) => viewed(product) && product.isActive && product.stock === 0,
      )
      .sort(byViews)
      .slice(0, ACTION_LIST_SIZE),
    sources: referrers.status === 'ok' ? foldSources(referrers.rows) : null,
  };
};

const foldSources = (
  rows: readonly { key: string; count: number }[],
): TrafficSource[] => {
  const visits = new Map<string, number>();
  for (const { key, count } of rows) {
    const label = sourceLabel(key);
    if (label) visits.set(label, (visits.get(label) ?? 0) + count);
  }
  return [...visits]
    .map(([label, count]) => ({ label, visits: count }))
    .sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label))
    .slice(0, SOURCE_LIST_SIZE);
};

/** The whole page read for the last `days` days, ending `now`. */
export const loadProductInsights = async (
  days: InsightWindowDays,
  now: Date = new Date(),
): Promise<ProductInsights> => {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const [sales, pageViews, referrers] = await Promise.all([
    OrderDao.salesByProductSince(cutoff),
    readUmamiMetric('pages', days, now),
    readUmamiMetric('referrers', days, now),
  ]);
  const slugs =
    pageViews.status === 'ok'
      ? [
          ...new Set(
            pageViews.rows.flatMap(({ key }) => productSlugOfPath(key) ?? []),
          ),
        ]
      : [];
  const products = await ProductDao.insightRows({
    ids: sales.map((row) => row.productId),
    slugs,
  });
  return buildProductInsights({ sales, products, pageViews, referrers });
};
