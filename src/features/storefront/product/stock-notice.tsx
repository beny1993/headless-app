import { AlertCircle, Check } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { AVAILABILITY, availability } from './availability';

/**
 * The three states the design draws, and the reason `availability` exists: the
 * notice and the add button read the same stock through the same function, so
 * «ناموجود» can never appear above a live add button.
 */
export function StockNotice({
  state,
  stock,
}: {
  state: ReturnType<typeof availability>;
  stock: number;
}) {
  if (state === AVAILABILITY.OUT_OF_STOCK) {
    return (
      <div className="bg-muted border-border flex items-start gap-2 rounded-xl border p-3">
        <AlertCircle
          size={16}
          className="text-muted-foreground mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold">فعلاً ناموجود است</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            به‌محض شارژ موجودی دوباره اینجا قرار می‌گیرد.
          </p>
        </div>
      </div>
    );
  }

  if (state === AVAILABILITY.LOW_STOCK) {
    return (
      <p className="text-warning flex items-center gap-1.5 text-sm">
        <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
        <span>
          تنها <span className="nums">{formatNumber(stock)}</span> عدد باقی
          مانده
        </span>
      </p>
    );
  }

  return (
    <p className="text-success-strong flex items-center gap-1.5 text-sm">
      <Check size={14} className="shrink-0" aria-hidden="true" />
      موجود در انبار
    </p>
  );
}
