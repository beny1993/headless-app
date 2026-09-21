import { toPersianDigits } from '@/lib/format';

/**
 * A stock cell that mirrors the design's availability badges.
 *
 * Three states, one boundary: nothing left, five or fewer («رو به اتمام»), and
 * anything above that. Lives here rather than inside the products route file so
 * the boundary can be pinned by a test beside it.
 */
export function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="bg-destructive-soft text-destructive rounded-full px-2.5 py-1 text-xs font-medium">
        ناموجود
      </span>
    );
  }
  const soft = stock <= 5;
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        soft
          ? 'bg-warning-soft text-warning'
          : 'bg-success-soft text-success-strong'
      }`}
    >
      {soft ? 'رو به اتمام' : 'موجود'} ({toPersianDigits(stock)})
    </span>
  );
}
