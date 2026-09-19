'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, X } from 'lucide-react';
import {
  SHOP_PET_OPTIONS,
  buildShopHref,
  updateShopQuery,
  type ShopQuery,
} from './shop-query';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ShopCategoryOption = {
  title: string;
  slug: string;
  /** `1` for a sub-category; the page orders them with `orderAsTree`. */
  depth: 0 | 1;
};

/**
 * The shop's filter panel: category, pet type and price range.
 *
 * Rendered twice — once in the desktop sidebar, once inside the mobile sheet
 * below — so every id is namespaced with `useId`; two `<input id="f-toys">` on
 * one page would point both labels at the first checkbox.
 *
 * Real inputs in labelled `<fieldset>`s, per the design review (finding 3: the
 * prototype's `div onClick` had no input element at all) — but `peer sr-only`
 * radios with the indicator drawn on the `<label>`, not the visible-control
 * card `checkout-form.tsx` uses. The rows are a dense list where the design
 * asks for a dot and a background rather than a box, which a native radio
 * cannot be styled into; `sr-only` keeps the real control for the keyboard and
 * the screen reader and lets the label carry the look.
 *
 * The cost is that the UA's focus ring is invisible too, so it is rebuilt on
 * the label through `peer-focus-visible:`. Anything that hides a native
 * indicator owes one back for **every** engine — the slider below is where
 * that debt went unpaid for Gecko.
 *
 * The panel holds no state of its own. Every change navigates to the URL that
 * describes the new filter set, and the next render reads it back — the URL is
 * the state, so a shared link and the back button cannot disagree with what is
 * on screen.
 *
 * The prototype's «برند» and «نیاز» groups are deliberately absent: the catalog
 * API has no parameters behind them, and a control that filters nothing is
 * worse than one that is missing (ledger finding 18).
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
      // While a navigation is in flight the controls still show the old URL's
      // state, because that is what is still on screen. Saying so beats
      // pretending the click did nothing.
      aria-busy={pending}
      className={cn(
        'transition-opacity duration-200 motion-reduce:transition-none',
        pending && 'opacity-60',
      )}
    >
      <ActiveFilters query={query} categories={categories} onChange={go} />

      <fieldset className="border-border/70 mb-5 border-b pb-5">
        <legend className="mb-2 text-sm font-semibold">دسته‌بندی</legend>
        {/* A real list, not `div`s: the indent alone is visual, and a screen
            reader has to hear that a sub-category sits inside its parent.
            Radios, not checkboxes — the panel mirrors a single `?category=`,
            and a box promises a multi-select the URL cannot hold. What a
            checkbox did give was click-to-clear; the «همه» row below restores
            it, and says out loud what was previously undiscoverable. The
            parent's *results* include its children (the DAO's job); the
            control does not pretend to. */}
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
                // The rail is the hierarchy. An indent alone left «مالت» and
                // «مکمل» looking like siblings at a glance, which is the thing
                // this panel most has to make obvious.
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

      <fieldset className="border-border/70 mb-5 border-b pb-5">
        <legend className="mb-2 text-sm font-semibold">نوع حیوان</legend>
        {/* Two options and a «no filter» state: a segmented control says that
            in one line, where four stacked checkbox rows said it in four and
            still left «both» unnamed. */}
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

/**
 * What is filtering the results right now, as one removable chip each.
 *
 * The panel already encodes this across three sections, but reading it meant
 * scanning all three. Stating it once, at the top, is what turns «why am I
 * seeing these products» into a glance — and each chip drops its own filter
 * without hunting for the control that set it.
 *
 * Renders nothing when nothing is applied, so an unfiltered shop is not asked
 * to carry an empty box.
 */
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
          // Clears the filters this panel shows — the ones with a chip beside
          // this button — and nothing else. A bare link to `/shop` also threw
          // away the search term and the sort, neither of which is a chip and
          // neither of which the shopper asked to undo; and being a link it
          // navigated *past* the sheet on mobile, leaving it open over the
          // results it had just changed.
          onClick={() =>
            onChange(
              updateShopQuery(query, {
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
              // Names the filter, not just «remove» — a screen reader reading
              // three of these in a row otherwise hears the same word thrice.
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

/** «از ۵۰٬۰۰۰ تا ۳۰۰٬۰۰۰» — whichever bounds are actually set. */
function priceLabel(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined)
    return `${formatNumber(min)} تا ${formatNumber(max)}`;
  if (min !== undefined) return `از ${formatNumber(min)}`;
  return `تا ${formatNumber(max ?? 0)}`;
}

/**
 * The flat, tree-ordered options as parents with their children. `orderAsTree`
 * has already put each sub-category straight after its parent, so one pass is
 * enough — no nested type travels from the page to here.
 */
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
 * One category row: a radio whose whole row is the target.
 *
 * The input is `sr-only` rather than hidden — it keeps the keyboard, the
 * grouping and the announcement the platform gives a radio, while the label
 * becomes a 44px row instead of a 16px box to aim at. Selection is carried by
 * fill **and** weight **and** the dot, never by colour alone.
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
        // One event name for one behaviour, sub-categories and «all» included.
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
 * Where the two handles start, for any URL at all.
 *
 * Both ends are clamped into the track and then kept a step apart. Clamping one
 * side each — the floor under `from`, the ceiling over `to` — left the pair
 * free to arrive crossed: `?maxPrice=1` put the high handle below the low one,
 * and one nudge of the low handle then rendered «−۹٬۹۹۹ تا ۱». A negative
 * Toman price is against the money rule whether or not anyone can reach it by
 * dragging, so the ordering is established here rather than trusted.
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
 * The price range, as a two-handled slider over the catalogue's own bounds.
 *
 * Built from two native `<input type="range">` stacked on one track rather than
 * a slider dependency: the platform brings the keyboard (arrows, Home/End), the
 * announced value and the focus ring, which is most of what a custom slider has
 * to rebuild. Only the thumbs take pointer events, so the one nearer the cursor
 * wins and neither input swallows clicks meant for the other.
 *
 * **Dragging does not navigate.** The handles are local state and commit once,
 * on release (pointer up, or key up for the keyboard) — a push per pixel would
 * be a navigation storm. The figure above the track updates live, so the
 * feedback is immediate even though the results are not.
 *
 * Resync is the same trick the inputs used: the fieldset is `key`ed on the
 * URL's bounds, so a cleared filter or the back button remounts it rather than
 * leaving the handles showing a range nobody asked for.
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

  // Nothing to slide over: an empty catalogue, or one where everything costs
  // the same. A slider with both handles on one point filters nothing.
  if (ceiling <= floor) return null;

  return (
    // Keyed on the bounds AND the track: a catalogue whose cheapest or
    // dearest product changed between navigations moves the ends the
    // handles are positioned against, and stale handles would be showing a
    // percentage of a track that no longer exists.
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
              // A handle left at its end is «no bound», not a bound that
              // happens to equal it — so clearing the slider clears the URL
              // instead of pinning `?minPrice=` to the cheapest product.
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
  // What the URL already says, so a release that moved nothing navigates
  // nowhere. `pointerUp` and `keyUp` fire for a bare click on the thumb and
  // for the Tab that lands on it — both used to push, and on mobile both also
  // closed the sheet, which put the price filter out of a keyboard shopper's
  // reach entirely. Remounted with the fieldset's `key`, so it never holds a
  // range the URL has moved on from.
  const applied = useRef<[number, number]>([from, to]);

  const pct = (value: number) => ((value - floor) / (ceiling - floor)) * 100;

  // Logical, not `left`: under `dir="rtl"` the browser flips the range inputs
  // so the floor sits at the right, and the fill has to start from the same
  // edge or it would run the wrong way.
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

  /**
   * Handles never cross — each stops a step short of the other — and neither
   * leaves the track. The ends are re-imposed here as well as on the way in:
   * this is the arithmetic that produced a negative price, and money is not a
   * place to rely on the caller.
   */
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

  // Which thumb takes the pointer where they overlap. They are a step apart at
  // most, which on a wide track is fewer pixels than a thumb is across, and the
  // max input — later in the DOM — swallowed every press once they met, so the
  // min handle could not be dragged back out. Whichever one is crowded against
  // the far end gets priority, so there is always a way out of the corner.
  const minOnTop = low > (floor + ceiling) / 2;

  const thumb =
    'pointer-events-none absolute inset-x-0 top-1/2 m-0 h-11 -translate-y-1/2 appearance-none bg-transparent focus-visible:outline-none ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-accent-strong [&::-webkit-slider-thumb]:shadow ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-accent-strong ' +
    'focus-visible:[&::-webkit-slider-thumb]:ring-accent-strong/40 focus-visible:[&::-webkit-slider-thumb]:ring-4 ' +
    // The same ring for Gecko. `focus-visible:outline-none` above takes the
    // native indicator away from every browser, so a ring written only for
    // `::-webkit-slider-thumb` left Firefox with no visible focus at all
    // (WCAG 2.4.7) — the keyboard still worked, silently.
    'focus-visible:[&::-moz-range-thumb]:ring-accent-strong/40 focus-visible:[&::-moz-range-thumb]:ring-4';

  return (
    <>
      {/* The figure, not the input, is what a shopper reads — so it is the one
          place the range is rendered, and it goes through `format.ts` like
          every other number on the storefront. */}
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
          // What the figure above the track says, not `150000` — every number
          // a shopper is given goes through `format.ts`, and a screen reader
          // is given this one.
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

      {/* Floor first: `justify-between` puts the first child at the *start*,
          which under `dir="rtl"` is the right — the same edge the browser
          flips the range input's minimum to. Written the other way round the
          labels contradict the track, which is exactly what they are there to
          explain. */}
      <div className="nums text-muted-foreground flex justify-between text-xs">
        <span>{formatNumber(floor)}</span>
        <span>{formatNumber(ceiling)}</span>
      </div>
    </>
  );
}

/**
 * The same panel on mobile, in a bottom sheet.
 *
 * Native modal `<dialog>`, the house pattern from `mobile-menu.tsx` and
 * `cart-drawer.tsx` — read that file's comments before changing anything here,
 * in particular why closing always goes through `close()` and never
 * `dialog.close()` alone. The design review asked for a real sheet with a focus
 * trap and Escape (finding 3); the platform gives both, plus nothing focusable
 * while it is shut.
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
  /** Shown on the confirm button, so the shopper knows before closing it. */
  total: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  // The same three groups `ActiveFilters` renders a chip for, price counted
  // once however many of its two bounds are set — «فیلتر (۲)» opening onto one
  // chip is the badge disagreeing with the panel it opens.
  const activeCount = [
    query.category,
    query.pet,
    query.minPrice ?? query.maxPrice,
  ].filter((value) => value !== undefined).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
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
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        onClose={() => setOpen(false)}
        // Target is the dialog itself → the click landed on the backdrop.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
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
            // A filter change navigates and the results are behind the sheet,
            // so it gets out of the way rather than leaving the shopper to
            // dismiss it before seeing what they just did.
            onApply={close}
          />
          <button
            type="button"
            onClick={close}
            className="bg-accent-strong hover:bg-accent-hover w-full rounded-xl py-3.5 font-bold text-white transition-colors"
            data-umami-event="shop-filter-sheet-apply"
          >
            نمایش {formatNumber(total)} محصول
          </button>
        </div>
      </dialog>
    </>
  );
}
