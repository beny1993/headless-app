import Image from 'next/image';
import Link from 'next/link';
import { Award, Check, Heart, Shield } from 'lucide-react';
import { shopPath } from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';

/**
 * The about page's sections, ported from the prototype's `AboutPage`
 * (`design/src/app/App.tsx`).
 *
 * All five live in one file rather than one-per-section like the home page:
 * this page is static server-rendered copy with no data source, no client
 * state and no shared pieces, so splitting it would only add files. For the
 * same reason there is no `content.ts` — the two arrays below have no consumer
 * but the section that renders them.
 */

/** The photo behind the hero. Bundled locally — see `public/ATTRIBUTIONS.md`. */
const HERO_IMAGE = '/site/hero-about.jpg';

/** Smokey herself, next to the story copy. Already bundled for the home page. */
const STORY_IMAGE = '/site/community-luna.jpg';

const PROCESS = [
  { step: 'بررسی', desc: 'تحقیق عمیق روی ترکیبات و برند' },
  { step: 'انتخاب', desc: 'انتخاب بهترین‌ها از بین صدها محصول' },
  { step: 'تجربه', desc: 'تست واقعی توسط تیم و مشتریان' },
  { step: 'پیشنهاد', desc: 'ارائه با اطمینان کامل' },
] as const;

const VALUES = [
  {
    icon: Award,
    title: 'کیفیت قبل از تعداد',
    desc: 'ترجیح می‌دهیم کمتر بفروشیم اما بهترین را بفروشیم.',
  },
  {
    icon: Shield,
    title: 'صداقت در پیشنهاد',
    desc: 'فقط چیزی پیشنهاد می‌دهیم که خودمان به آن ایمان داریم.',
  },
  {
    icon: Heart,
    title: 'احترام به حیوانات',
    desc: 'رفاه حیوانات در تمام تصمیمات ما اولویت دارد.',
  },
  {
    icon: Check,
    title: 'تجربه واقعی',
    desc: 'محصولاتمان را واقعاً تست می‌کنیم، نه فقط مطالعه.',
  },
] as const;

/**
 * The hero.
 *
 * `min-h-[70vh]` where the prototype has a fixed `h-[70vh]`. Measured, the
 * hero's content is 279px at 375px wide, so a fixed 70vh only starts clipping
 * under `overflow-hidden` below a ~400px-tall viewport — no phone in portrait.
 * `min-h` is kept anyway because it costs nothing and the copy here is the kind
 * that grows. The prototype's own `pt-20` is gone — the storefront layout
 * already offsets the fixed navbar.
 *
 * White text lands on `--ink` with the photo at 40% plus a gradient, which is
 * what keeps the copy at a predictable contrast ratio instead of floating over
 * an unpredictable photograph.
 */
function AboutHero() {
  return (
    <section className="bg-ink relative flex min-h-[70vh] items-center overflow-hidden">
      <Image
        src={HERO_IMAGE}
        alt="اسموکی، گربه‌ای که فروشگاه از او شروع شد"
        fill
        // Above the fold and full-bleed: the page's LCP element.
        priority
        sizes="100vw"
        className="object-cover opacity-40"
      />
      <div className="from-ink absolute inset-0 bg-gradient-to-l to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
        <p className="text-accent-on-dark mb-4 text-sm font-medium tracking-wide">
          داستان ما
        </p>
        <h1
          className="font-black text-white"
          style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', lineHeight: 1.2 }}
        >
          همه‌چیز از عشق
          <br />
          به یک گربه
          <br />
          <span className="text-accent-on-dark">شروع شد.</span>
        </h1>
      </div>
    </section>
  );
}

function AboutStory() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <div className="relative h-96 overflow-hidden rounded-3xl">
            <Image
              src={STORY_IMAGE}
              alt="اسموکی، گربه‌ای سیاه‌وسفید با چشمان سبز"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <h2 className="mb-6 text-3xl font-black">این اسموکی‌ه</h2>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              وقتی اسموکی وارد زندگی‌مان شد، متوجه شدیم که پیدا کردن محصولات
              واقعاً مناسب چقدر سخت است. بازار پر از گزینه‌هاست اما اطلاعات درست
              کمیاب.
            </p>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              اسموکی فروشگاه از همین سوال ساده متولد شد: «چه محصولی واقعاً برای
              حیوان خانگی من خوب است؟»
            </p>
            <p className="text-muted-foreground leading-relaxed">
              امروز هر محصولی که پیشنهاد می‌دهیم، از فیلتر دقیق کیفیت، ترکیبات،
              و تجربه واقعی گذشته.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutProcess() {
  return (
    <section className="bg-secondary/30 py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-black">فرآیند انتخاب محصولات</h2>
        </div>
        <ol className="relative flex flex-col gap-6 md:flex-row">
          {PROCESS.map((item, index) => (
            <li key={item.step} className="relative flex-1 text-center">
              <div className="bg-accent-strong mx-auto mb-4 flex size-12 items-center justify-center rounded-full text-lg font-black text-white">
                {toPersianDigits(index + 1)}
              </div>
              <h3 className="mb-2 text-lg font-bold">{item.step}</h3>
              <p className="text-muted-foreground text-sm">{item.desc}</p>
              {index < PROCESS.length - 1 && (
                // The connector runs the full width of the row, so it is
                // direction-neutral decoration — physical placement is fine
                // here (design review, finding 9).
                <div
                  className="bg-border absolute top-6 left-0 -z-10 hidden h-0.5 w-full md:block"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AboutValues() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-black">ارزش‌های ما</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {VALUES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="bg-card border-border rounded-2xl border p-7"
            >
              <div className="bg-accent/10 text-accent-strong mb-4 flex size-12 items-center justify-center rounded-xl">
                <Icon size={20} aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-lg font-bold">{title}</h3>
              <p className="text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The closing call to action. The prototype's button navigated to the shop.
 *
 * This is the only interactive element in the app that sits on an
 * `--accent-strong` surface, and the global focus ring is `--ring` (#C9623F) —
 * 1.26:1 against that fill, i.e. invisible, failing WCAG 2.2 SC 1.4.11. The
 * outline is white here (4.99:1) instead; every other button in the app is on
 * a light or `--ink` surface where the default ring still measures fine.
 */
function AboutCta() {
  return (
    <section className="bg-accent-strong px-4 py-24 text-center">
      <h2 className="mb-4 text-4xl font-black text-white">
        به خانواده اسموکی خوش اومدی.
      </h2>
      <Link
        href={shopPath()}
        className="text-accent-strong mt-4 inline-block rounded-xl bg-white px-8 py-4 font-bold transition-colors hover:bg-white/90 focus-visible:outline-white"
        data-umami-event="about-cta-shop-click"
      >
        کشف محصولات
      </Link>
    </section>
  );
}

export { AboutHero, AboutStory, AboutProcess, AboutValues, AboutCta };
