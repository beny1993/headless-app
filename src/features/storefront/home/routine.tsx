'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ROUTINE_TARGETS } from './content';
import type { CategoryTile } from './categories';
import type { ContentValue } from '@/lib/content/site-content';
import { shopPath } from '@/lib/constant/paths';

/**
 * «روتین روزانه» — four times of day, each opening the categories that serve
 * it. Client only for the active tab.
 *
 * The eyebrow, headline, body and the four tabs' label/sub are admin content
 * (`home.routine`), and so are the categories each tab opens (`categoryIds`, by
 * id; unset, the slugs in `ROUTINE_TARGETS`, zipped by index). Each tab's emoji
 * stays in code. The tile titles come from
 * the database, the «مشاهده محصولات ←» and empty state stay in code — so nothing
 * here can name a category that does not exist, and no editable label rides a
 * fixed link.
 */
export function RoutineSection({
  content,
  categories,
}: {
  content: ContentValue<'home.routine'>;
  categories: CategoryTile[];
}) {
  const [active, setActive] = useState(0);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const bySlug = new Map(
    categories.map((category) => [category.slug, category]),
  );
  const slot = content.slots[active];
  const target = ROUTINE_TARGETS[active];
  // The saved categories in the saved order, else the code slugs; a category
  // deleted since it was picked simply drops out.
  const tiles = (
    slot.categoryIds?.map((id) => byId.get(id)) ??
    target.categories.map((slug) => bySlug.get(slug))
  ).filter((category): category is CategoryTile => category !== undefined);

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <span className="text-accent-strong mb-3 inline-block text-sm font-medium">
            {content.eyebrow}
          </span>
          <h2 className="text-4xl font-black">{content.headline}</h2>
        </div>

        <div className="flex flex-col items-start gap-8 lg:flex-row">
          {/* Toggle buttons, not `role="tab"`: the tab pattern promises
              arrow-key roving focus that this does not implement, and a
              half-built widget reads worse than a plain pressed button. */}
          <div className="flex w-full shrink-0 gap-2 overflow-x-auto pb-2 lg:w-48 lg:flex-col lg:overflow-x-visible lg:pb-0">
            {content.slots.map((option, index) => (
              <button
                // Index key: labels are editable content and may repeat.
                key={index}
                type="button"
                aria-pressed={active === index}
                onClick={() => setActive(index)}
                className={`flex shrink-0 items-center gap-3 rounded-xl p-4 text-start transition-colors duration-200 ${
                  active === index
                    ? 'bg-accent-strong text-white'
                    : 'hover:bg-secondary'
                }`}
                data-umami-event="home-routine-tab-click"
              >
                <span className="text-2xl" aria-hidden="true">
                  {ROUTINE_TARGETS[index].emoji}
                </span>
                <span>
                  <span className="block font-bold">{option.label}</span>
                  <span
                    className={`block text-sm ${
                      active === index
                        ? 'text-white/80'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {option.sub}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="bg-secondary/40 flex-1 rounded-3xl p-8">
            <h3 className="mb-2 text-xl font-bold">
              {slot.label} — {slot.sub}
            </h3>
            <p className="text-muted-foreground mb-6 whitespace-pre-line">
              {content.body}
            </p>
            {tiles.length === 0 && (
              <p className="text-muted-foreground text-sm">
                دسته‌بندی‌های این مرحله هنوز ثبت نشده‌اند.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {tiles.map((category) => (
                <Link
                  key={category.slug}
                  href={shopPath({ category: category.slug })}
                  className="bg-card flex items-center gap-4 rounded-xl p-5 transition-shadow hover:shadow-md"
                  data-umami-event="home-routine-category-click"
                >
                  <span
                    className="bg-secondary flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl"
                    aria-hidden="true"
                  >
                    {target.emoji}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">
                      {category.title}
                    </span>
                    <span className="text-accent-strong mt-1 block text-xs">
                      مشاهده محصولات ←
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
