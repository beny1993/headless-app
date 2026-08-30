import { DEFAULT_SITE_NAME } from '@/constants';
import {
  formatJalali,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';

// Foundation sample page: renders the ported theme tokens and the shared
// formatters so the palette can be eyeballed against `design/`. The real home
// page is ported by [[Story - Storefront Home Page]] and replaces this.

const SURFACES = [
  { token: 'bg-background text-foreground', label: 'background' },
  { token: 'bg-card text-card-foreground border', label: 'card' },
  { token: 'bg-secondary text-secondary-foreground', label: 'secondary' },
  { token: 'bg-muted text-muted-foreground', label: 'muted' },
  { token: 'bg-primary text-primary-foreground', label: 'primary' },
  { token: 'bg-ink text-white', label: 'ink' },
  { token: 'bg-ink-soft text-white', label: 'ink-soft' },
];

const ACCENTS = [
  { token: 'bg-accent text-accent-foreground', label: 'accent' },
  { token: 'bg-accent-strong text-white', label: 'accent-strong' },
  { token: 'bg-accent-hover text-white', label: 'accent-hover' },
  { token: 'bg-accent-soft text-accent-hover', label: 'accent-soft' },
  { token: 'bg-ink text-accent-on-dark', label: 'accent-on-dark' },
];

const STATUSES = [
  { token: 'bg-success-soft text-success-strong', label: 'success' },
  { token: 'bg-warning-soft text-warning', label: 'warning' },
  { token: 'bg-info-soft text-info', label: 'info' },
  { token: 'bg-tan-soft text-tan-strong', label: 'tan' },
  { token: 'bg-destructive-soft text-destructive', label: 'destructive' },
];

function Swatches({
  title,
  items,
}: {
  title: string;
  items: { token: string; label: string }[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <div className="flex flex-wrap gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className={`${item.token} flex h-20 w-40 items-center justify-center rounded-lg text-sm font-medium`}
          >
            {item.label}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const sample = new Date(Date.UTC(2026, 7, 29, 12, 0, 0));

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-16 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-4xl font-black tracking-tight">
          {DEFAULT_SITE_NAME}
        </h1>
        <p className="text-muted-foreground mt-2">
          صفحه نمونه پایه — رنگ‌ها و قالب‌بندی‌های مشترک
        </p>
      </header>

      <Swatches title="سطح‌ها" items={SURFACES} />
      <Swatches title="رنگ برند" items={ACCENTS} />
      <Swatches title="وضعیت‌ها" items={STATUSES} />

      <section>
        <h2 className="mb-3 text-lg font-bold">قالب‌بندی‌ها</h2>
        <dl className="bg-card grid max-w-xl grid-cols-2 gap-y-3 rounded-lg border p-6">
          <dt className="text-muted-foreground text-sm">قیمت</dt>
          <dd className="nums text-accent-strong font-bold">
            {formatToman(2450000n)}
          </dd>

          <dt className="text-muted-foreground text-sm">قیمت بزرگ</dt>
          <dd className="nums font-bold">{formatToman(9007199254740993n)}</dd>

          <dt className="text-muted-foreground text-sm">عدد</dt>
          <dd className="nums">{formatNumber(12345)}</dd>

          <dt className="text-muted-foreground text-sm">شماره سفارش</dt>
          <dd className="nums">{toPersianDigits(10045)}</dd>

          <dt className="text-muted-foreground text-sm">تاریخ</dt>
          <dd className="nums">{formatJalali(sample)}</dd>
        </dl>
      </section>
    </main>
  );
}
