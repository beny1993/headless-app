import Image from 'next/image';
import Link from 'next/link';
import { STORY_IMAGE } from './content';
import { shopPath } from '@/lib/constant/paths';

/**
 * «راهنمای اسموکی» — an editorial block above the fold of the lower page.
 *
 * The magazine it originally linked to is parked on the backlog, so the CTA
 * points at the products the text is actually about (wet food, for a cat that
 * does not drink enough) rather than shipping a dead article route — the
 * design review's port note on the magazine.
 *
 * The eyebrow uses `accent-on-dark`, not `accent`: on `--ink-soft` the brand
 * terracotta measures 3.29:1 and fails AA.
 */
export function FeaturedStorySection() {
  return (
    <section className="bg-ink py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="grid grid-cols-1 overflow-hidden rounded-3xl lg:grid-cols-2">
          <div className="relative h-80 lg:h-auto">
            <Image
              src={STORY_IMAGE}
              alt="گربه‌ای کنار ظرف آب"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="bg-ink-soft flex flex-col justify-center p-10 lg:p-14">
            <span className="text-accent-on-dark mb-4 text-sm font-medium tracking-wide">
              راهنمای اسموکی
            </span>
            <h2 className="mb-5 text-3xl leading-tight font-black text-white lg:text-4xl">
              چرا بعضی گربه‌ها
              <br />
              آب کافی نمی‌خورند؟
            </h2>
            <p className="mb-8 leading-relaxed text-white/70">
              کم‌آبی در گربه‌ها یکی از مشکلات شایعی است که بسیاری از صاحبان
              نادیده می‌گیرند. غذای مرطوب ساده‌ترین راه جبران آن در وعده‌های
              روزانه است.
            </p>
            <Link
              href={shopPath({ category: 'wet-food' })}
              className="bg-accent-strong hover:bg-accent-hover self-start rounded-xl px-6 py-3 font-bold text-white transition-colors"
              data-umami-event="home-story-shop-click"
            >
              مشاهده غذای مرطوب
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
