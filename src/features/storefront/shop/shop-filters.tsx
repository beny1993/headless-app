'use client';

import { Suspense, use, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Filter, X } from 'lucide-react';
import {
  SHOP_PET_OPTIONS,
  buildShopHref,
  updateShopQuery,
  type ShopQuery,
} from './shop-query';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ShopCategoryOption = {
  title: string;
  slug: string;
  /** `1` for a sub-category; the page orders them with `orderAsTree`. */
  depth: 0 | 1;
};

/**
 * The shop's filter panel: category, in stock only, pet type and price range.
 *
 * Rendered twice (desktop sidebar, mobile sheet), so every id is namespaced
 * with `useId`.
 *
 * Real inputs in labelled `<fieldset>`s: `peer sr-only` radios with the look
 * drawn on the `<label>`. Hiding the native control hides its focus ring too,
 * so it is rebuilt through `peer-focus-visible:` — anything that hides a
 * native indicator owes one back for **every** engine.
 *
 * No state of its own: every change navigates, and the URL is the state.
 * The prototype's «برند» and «نیاز» groups are absent — the catalog API has
 * nothing behind them.
 */
export function ShopFilters({
  query,
  categories,
  priceBounds,
  onApply,
}: {
  query: ShopQuery;
  categories: readonly ShopCategoryOption[];
  /** The catalogue's cheapest and dearest, for the price slider's ends. */
  priceBounds: { min: number; max: number };
  /** The sheet closes itself after a change; the sidebar passes nothing. */
  onApply?: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();

  const go = (next: ShopQuery) => {
    startTransition(() => router.push(buildShopHref(next)));
    onApply?.();
  };

  return (
    <div
      // The controls show the old URL's state until the navigation lands.
      aria-busy={pending}
      className={cn(
        'transition-opacity duration-200 motion-reduce:transition-none',
        pending && 'opacity-60',
      )}
    >
      <ActiveFilters query={query} categories={categories} onChange={go} />

      <fieldset className="border-border/70 mb-5 border-b pb-5">
        <legend className="mb-2 text-sm font-semibold">دسته‌بندی</legend>
        {/* A nested list so a screen reader hears the hierarchy. Radios: the
            URL holds a single `?category=`; the «همه» row clears it. */}
        <ul className="space-y-0.5">
          <li>
            <CategoryRow
              label="همه دسته‌بندی‌ها"
              value=""
              ids={ids}
              checked={query.category === undefined}
              onSelect={() =>
                go(updateShopQuery(query, { category: undefined }))
              }
            />
          </li>
          {categoryGroups(categories).map(({ parent, children }) => (
            <li key={parent.slug}>
              <CategoryRow
                label={parent.title}
                value={parent.slug}
                ids={ids}
                checked={query.category === parent.slug}
                onSelect={() =>
                  go(updateShopQuery(query, { category: parent.slug }))
                }
              />
              {children.length > 0 && (
                // The rail shows the hierarchy an indent alone did not.
                <ul className="border-border ms-3 mt-0.5 space-y-0.5 border-s ps-3">
                  {children.map((child) => (
                    <li key={child.slug}>
                      <CategoryRow
                        label={child.title}
                        value={child.slug}
                        ids={ids}
                        nested
                        checked={query.category === child.slug}
                        onSelect={() =>
                          go(updateShopQuery(query, { category: child.slug }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="border-border/70 mb-5 border-b pb-5">
        <InStockSwitch
          id={`${ids}-in-stock`}
          checked={query.inStock === true}
          // Off is «no filter», so it leaves the URL rather than writing false.
          onToggle={(on) =>
            go(updateShopQuery(query, { inStock: on || undefined }))
          }
        />
      </div>

      <fieldset className="border-border/70 mb-5 border-b pb-5">
        <legend className="mb-2 text-sm font-semibold">نوع حیوان</legend>
        <div className="bg-secondary flex gap-1 rounded-xl p-1">
          <PetSegment
            label="همه"
            value=""
            ids={ids}
            checked={query.pet === undefined}
            onSelect={() => go(updateShopQuery(query, { pet: undefined }))}
          />
          {SHOP_PET_OPTIONS.map((pet) => (
            <PetSegment
              key={pet.value}
              label={pet.label}
              value={pet.value}
              ids={ids}
              checked={query.pet === pet.value}
              onSelect={() => go(updateShopQuery(query, { pet: pet.value }))}
            />
          ))}
        </div>
      </fieldset>

      <PriceFilter query={query} bounds={priceBounds} onSubmit={go} />
    </div>
  );
}

/** What is filtering the results right now, one removable chip each. */
function ActiveFilters({
  query,
  categories,
  onChange,
}: {
  query: ShopQuery;
  categories: readonly ShopCategoryOption[];
  onChange: (next: ShopQuery) => void;
}) {
  const chips: { key: string; label: string; clear: ShopQuery }[] = [];

  if (query.category !== undefined) {
    const title =
      categories.find((category) => category.slug === query.category)?.title ??
      query.category;
    chips.push({
      key: 'category',
      label: title,
      clear: updateShopQuery(query, { category: undefined }),
    });
  }
  // In the panel's own order — under «دسته‌بندی» — so the chips read the way
  // the controls do.
  if (query.inStock) {
    chips.push({
      key: 'inStock',
      label: IN_STOCK_LABEL,
      clear: updateShopQuery(query, { inStock: undefined }),
    });
  }
  if (query.pet !== undefined) {
    const pet = SHOP_PET_OPTIONS.find((option) => option.value === query.pet);
    chips.push({
      key: 'pet',
      label: pet?.label ?? query.pet,
      clear: updateShopQuery(query, { pet: undefined }),
    });
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    chips.push({
      key: 'price',
      label: priceLabel(query.minPrice, query.maxPrice),
      clear: updateShopQuery(query, {
        minPrice: undefined,
        maxPrice: undefined,
      }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="border-border/70 mb-5 border-b pb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">فیلترهای فعال</p>
        <button
          type="button"
          // Clears the chip filters only — the search term and sort stay —
          // and goes through `onChange`, so the mobile sheet closes too.
          onClick={() =>
            onChange(
              updateShopQuery(query, {
                inStock: undefined,
                category: undefined,
                pet: undefined,
                minPrice: undefined,
                maxPrice: undefined,
              }),
            )
          }
          className="text-accent-strong rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          data-umami-event="shop-filter-clear"
        >
          پاک کردن همه
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <button
              type="button"
              onClick={() => onChange(chip.clear)}
              className="bg-accent-soft text-foreground hover:bg-secondary focus-visible:ring-accent-strong inline-flex min-h-9 items-center gap-1.5 rounded-full ps-3 pe-2 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
              aria-label={`حذف فیلتر ${chip.label}`}
              data-umami-event="shop-filter-chip-remove"
            >
              <span className="nums">{chip.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The switch's words, and its chip's. */
const IN_STOCK_LABEL = 'فقط محصولات موجود';

/**
 * «فقط محصولات موجود» — the category row's bones as a checkbox: an `sr-only`
 * input whose 44px label is the target, its focus ring rebuilt on the label.
 * The tick carries the state by shape as well as by fill.
 */
function InStockSwitch({
  id,
  checked,
  onToggle,
}: {
  id: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <>
      <input
        type="checkbox"
        id={id}
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        data-umami-event="shop-filter-in-stock-toggle"
      />
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm transition-colors duration-200 select-none',
          'hover:bg-secondary motion-reduce:transition-none',
          'peer-focus-visible:ring-accent-strong peer-focus-visible:ring-2',
          checked
            ? 'bg-accent-soft text-foreground font-semibold'
            : 'text-muted-foreground',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-200 motion-reduce:transition-none',
            checked
              ? 'bg-accent-strong border-accent-strong text-white'
              : // `muted-foreground`, not the `border` token: a lone box has no
                // ticked neighbour to read against, so its edge needs 3:1.
                'border-muted-foreground bg-background',
          )}
        >
          {checked && <Check size={12} strokeWidth={3} />}
        </span>
        {IN_STOCK_LABEL}
      </label>
    </>
  );
}

/** «از ۵۰٬۰۰۰ تا ۳۰۰٬۰۰۰» — whichever bounds are actually set. */
function priceLabel(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined)
    return `${formatNumber(min)} تا ${formatNumber(max)}`;
  if (min !== undefined) return `از ${formatNumber(min)}`;
  return `تا ${formatNumber(max ?? 0)}`;
}

/** The tree-ordered options (`orderAsTree`) as parents with their children. */
function categoryGroups(categories: readonly ShopCategoryOption[]) {
  const groups: {
    parent: ShopCategoryOption;
    children: ShopCategoryOption[];
  }[] = [];
  for (const category of categories) {
    const last = groups.at(-1);
    if (category.depth === 1 && last) last.children.push(category);
    else groups.push({ parent: category, children: [] });
  }
  return groups;
}

/**
 * One category row: an `sr-only` radio whose 44px label is the target.
 * Selection is carried by fill, weight and the dot — never colour alone.
 */
function CategoryRow({
  label,
  value,
  ids,
  checked,
  nested = false,
  onSelect,
}: {
  label: string;
  /** Empty for «all»; only ever used to build the input's id. */
  value: string;
  ids: string;
  checked: boolean;
  nested?: boolean;
  onSelect: () => void;
}) {
  const id = `${ids}-category-${value || 'all'}`;

  return (
    <>
      <input
        type="radio"
        id={id}
        name={`${ids}-category`}
        className="peer sr-only"
        checked={checked}
        onChange={onSelect}
        data-umami-event="shop-filter-category-toggle"
      />
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm transition-colors duration-200 select-none',
          'hover:bg-secondary motion-reduce:transition-none',
          'peer-focus-visible:ring-accent-strong peer-focus-visible:ring-2',
          nested && 'text-[0.8125rem]',
          checked
            ? 'bg-accent-soft text-foreground font-semibold'
            : 'text-muted-foreground',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none',
            checked ? 'bg-accent-strong' : 'bg-border',
          )}
        />
        {label}
      </label>
    </>
  );
}

/** One cell of the pet segmented control — same radio bones as a row. */
function PetSegment({
  label,
  value,
  ids,
  checked,
  onSelect,
}: {
  label: string;
  value: string;
  ids: string;
  checked: boolean;
  onSelect: () => void;
}) {
  const id = `${ids}-pet-${value || 'all'}`;

  return (
    <div className="flex-1">
      <input
        type="radio"
        id={id}
        name={`${ids}-pet`}
        className="peer sr-only"
        checked={checked}
        onChange={onSelect}
        data-umami-event="shop-filter-pet-toggle"
      />
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-sm transition-colors duration-200 select-none',
          'peer-focus-visible:ring-accent-strong peer-focus-visible:ring-2',
          checked
            ? 'bg-background text-foreground font-semibold shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
      </label>
    </div>
  );
}

/** Slider granularity, and what the offered bounds are rounded to. */
const PRICE_STEP = 10_000;

const floorTo = (value: number, step: number) =>
  Math.floor(value / step) * step;
const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

/**
 * Where the two handles start, for any URL: both clamped into the track and
 * kept a step apart, so a hand-typed URL can never produce crossed handles
 * and, from them, a negative price.
 */
const trackRange = (
  query: ShopQuery,
  floor: number,
  ceiling: number,
): { from: number; to: number } => {
  const clamp = (value: number) => Math.min(ceiling, Math.max(floor, value));
  const from = Math.min(clamp(query.minPrice ?? floor), ceiling - PRICE_STEP);
  return {
    from,
    to: Math.max(clamp(query.maxPrice ?? ceiling), from + PRICE_STEP),
  };
};

/**
 * The price range: two native `<input type="range">` stacked on one track (the
 * platform brings keyboard, announcement and focus). Only the thumbs take
 * pointer events.
 *
 * **Dragging does not navigate** — the handles are local state and commit on
 * release (pointer up / key up); the figure above updates live.
 */
function PriceFilter({
  query,
  bounds,
  onSubmit,
}: {
  query: ShopQuery;
  /** The catalogue's own cheapest and dearest, before rounding. */
  bounds: { min: number; max: number };
  onSubmit: (next: ShopQuery) => void;
}) {
  const floor = floorTo(bounds.min, PRICE_STEP);
  const ceiling = ceilTo(bounds.max, PRICE_STEP);

  // Nothing to slide over: an empty catalogue, or one price for everything.
  if (ceiling <= floor) return null;

  return (
    // Keyed on the URL's bounds AND the track, so a cleared filter, the back
    // button or a changed catalogue remounts the handles.
    <fieldset key={`${query.minPrice}-${query.maxPrice}-${floor}-${ceiling}`}>
      <legend className="mb-2 text-sm font-semibold">
        محدوده قیمت (تومان)
      </legend>
      <PriceSlider
        floor={floor}
        ceiling={ceiling}
        {...trackRange(query, floor, ceiling)}
        onCommit={(from, to) =>
          onSubmit(
            updateShopQuery(query, {
              // A handle at its end is «no bound», not a bound equal to it.
              minPrice: from <= floor ? undefined : from,
              maxPrice: to >= ceiling ? undefined : to,
            }),
          )
        }
      />
    </fieldset>
  );
}

function PriceSlider({
  floor,
  ceiling,
  from,
  to,
  onCommit,
}: {
  floor: number;
  ceiling: number;
  from: number;
  to: number;
  onCommit: (from: number, to: number) => void;
}) {
  const [range, setRange] = useState<[number, number]>([from, to]);
  const [low, high] = range;
  // What the URL already says: `pointerUp`/`keyUp` also fire for a bare click
  // and for the Tab that lands on a thumb, and must not navigate (on mobile
  // that closes the sheet).
  const applied = useRef<[number, number]>([from, to]);

  const pct = (value: number) => ((value - floor) / (ceiling - floor)) * 100;

  // Logical, not `left`: RTL flips the range inputs, and the fill must follow.
  const fill = {
    insetInlineStart: `${pct(low)}%`,
    width: `${pct(high) - pct(low)}%`,
  };

  const commit = () => {
    const [appliedLow, appliedHigh] = applied.current;
    if (low === appliedLow && high === appliedHigh) return;
    applied.current = [low, high];
    onCommit(low, high);
  };

  /** Handles never cross and never leave the track — re-imposed here too. */
  const setLow = (value: number) =>
    setRange(([, currentHigh]) => [
      Math.max(floor, Math.min(value, currentHigh - PRICE_STEP)),
      currentHigh,
    ]);
  const setHigh = (value: number) =>
    setRange(([currentLow]) => [
      currentLow,
      Math.min(ceiling, Math.max(value, currentLow + PRICE_STEP)),
    ]);

  // Where the thumbs overlap, the one crowded toward the far end is on top,
  // so there is always a way out of the corner.
  const minOnTop = low > (floor + ceiling) / 2;

  const thumb =
    'pointer-events-none absolute inset-x-0 top-1/2 m-0 h-11 -translate-y-1/2 appearance-none bg-transparent focus-visible:outline-none ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-accent-strong [&::-webkit-slider-thumb]:shadow ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-accent-strong ' +
    'focus-visible:[&::-webkit-slider-thumb]:ring-accent-strong/40 focus-visible:[&::-webkit-slider-thumb]:ring-4 ' +
    // The same ring for Gecko: `outline-none` removed it from every engine.
    'focus-visible:[&::-moz-range-thumb]:ring-accent-strong/40 focus-visible:[&::-moz-range-thumb]:ring-4';

  return (
    <>
      <p className="nums text-muted-foreground mb-3 text-sm">
        {formatNumber(low)} تا {formatNumber(high)}
      </p>

      <div className="relative h-11">
        <div className="bg-secondary absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
        <div
          className="bg-accent-strong absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={fill}
        />
        <input
          type="range"
          min={floor}
          max={ceiling}
          step={PRICE_STEP}
          value={low}
          onChange={(event) => setLow(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          aria-label="کمترین قیمت"
          aria-valuetext={`${formatNumber(low)} تومان`}
          className={cn(thumb, minOnTop ? 'z-20' : 'z-10')}
          data-umami-event="shop-filter-min-price-drag"
        />
        <input
          type="range"
          min={floor}
          max={ceiling}
          step={PRICE_STEP}
          value={high}
          onChange={(event) => setHigh(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          aria-label="بیشترین قیمت"
          aria-valuetext={`${formatNumber(high)} تومان`}
          className={cn(thumb, minOnTop ? 'z-10' : 'z-20')}
          data-umami-event="shop-filter-max-price-drag"
        />
      </div>

      {/* Floor first: the start edge, where RTL puts the range's minimum. */}
      <div className="nums text-muted-foreground flex justify-between text-xs">
        <span>{formatNumber(floor)}</span>
        <span>{formatNumber(ceiling)}</span>
      </div>
    </>
  );
}

/**
 * The same panel on mobile, in a bottom sheet: a native modal `<dialog>`
 * through `useModalDialog` (read its comment before changing this).
 */
export function ShopFilterSheet({
  query,
  categories,
  priceBounds,
  total,
}: {
  query: ShopQuery;
  categories: readonly ShopCategoryOption[];
  /** Handed straight to the panel below. */
  priceBounds: { min: number; max: number };
  /**
   * Shown on the confirm button, so the shopper knows before closing it. The
   * shop passes the listing's promise, so the sheet's button is there at once
   * and the count fills in when the listing streams in.
   */
  total: number | Promise<number>;
}) {
  const { open, show, close, dialogProps } = useModalDialog();

  // One per `ActiveFilters` chip — price counts once, however many bounds.
  const activeCount = [
    query.inStock || undefined,
    query.category,
    query.pet,
    query.minPrice ?? query.maxPrice,
  ].filter((value) => value !== undefined).length;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="border-border hover:bg-secondary flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors lg:hidden"
        aria-expanded={open}
        data-umami-event="shop-filter-sheet-open"
      >
        <Filter size={14} aria-hidden="true" />
        فیلتر
        {activeCount > 0 && (
          <span className="nums">({formatNumber(activeCount)})</span>
        )}
      </button>

      <dialog
        {...dialogProps}
        // Pinned to the bottom edge, undoing the UA's centred-box defaults.
        className="bg-background fixed inset-x-0 bottom-0 m-0 mt-auto max-h-[80vh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 p-0 shadow-lg backdrop:bg-black/50 lg:hidden"
        aria-label="فیلترها"
      >
        <div className="flex items-center justify-between border-b p-4">
          <p className="font-semibold">فیلترها</p>
          <button
            type="button"
            onClick={close}
            className="hover:bg-secondary flex size-10 items-center justify-center rounded-full transition-colors"
            aria-label="بستن فیلترها"
            data-umami-event="shop-filter-sheet-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="p-4">
          <ShopFilters
            query={query}
            categories={categories}
            priceBounds={priceBounds}
            // The results are behind the sheet, so a change closes it.
            onApply={close}
          />
          <button
            type="button"
            onClick={close}
            className="bg-brand hover:bg-brand-hover text-brand-foreground w-full rounded-xl py-3.5 font-bold transition-colors"
            data-umami-event="shop-filter-sheet-apply"
          >
            <Suspense fallback="نمایش محصولات">
              <ApplyLabel total={total} />
            </Suspense>
          </button>
        </div>
      </dialog>
    </>
  );
}

/** «نمایش N محصول», once the count is in. */
function ApplyLabel({ total }: { total: number | Promise<number> }) {
  const count = typeof total === 'number' ? total : use(total);
  return <>نمایش {formatNumber(count)} محصول</>;
}
