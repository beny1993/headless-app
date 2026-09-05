'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { postData } from '@/lib/api-client';
import { apiAdminOrderTransitionsPath } from '@/lib/constant/paths';
import {
  adminNextStatuses,
  ORDER_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import { cn } from '@/lib/utils';

/**
 * The admin's status-change control. The buttons it offers are DERIVED from the
 * `status` prop via `adminNextStatuses` — the same client-safe subset the server
 * enforces — so the UI can never offer an illegal edge and never drifts from the
 * machine. There is deliberately NO local `status` state: on success the control
 * calls `router.refresh()` and the server re-renders it with the order's new
 * status, which is the single source of truth. (Local state derived from a prop
 * that this component then changes is exactly the state-sync bug class the
 * component-test rule guards; keeping only `busy`/`error` local avoids it.)
 *
 * The server still rejects an illegal or stale transition (400/409); this only
 * decides what to *offer*. A terminal order offers nothing.
 */
export function OrderTransition({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const next = adminNextStatuses(status);

  if (next.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Check size={14} className="text-success-strong" aria-hidden="true" />
        این سفارش در وضعیت نهایی «{orderStatusBadge(status).label}» است و تغییر
        دیگری ندارد.
      </p>
    );
  }

  const move = async (to: OrderStatus) => {
    setError(null);
    setBusy(to);
    try {
      await postData(apiAdminOrderTransitionsPath(orderId), { to });
      // The server is now authoritative; re-render from it rather than tracking
      // the new status locally. Leave `busy` set — this control is about to be
      // replaced by the refreshed one, and it must not accept a second click.
      router.refresh();
    } catch (requestError) {
      setBusy(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'تغییر وضعیت سفارش ناموفق بود. دوباره تلاش کن.',
      );
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {next.map((to) => {
          const isCancel = to === ORDER_STATUSES.CANCELLED;
          return (
            <button
              key={to}
              type="button"
              onClick={() => move(to)}
              disabled={busy !== null}
              data-umami-event={`admin-panel-order-transition-${to}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50',
                isCancel
                  ? 'border-destructive/40 text-destructive hover:bg-destructive-soft border-2'
                  : 'bg-accent-strong hover:bg-accent-hover text-white',
              )}
            >
              {busy === to && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {isCancel
                ? 'لغو سفارش'
                : `تغییر به «${orderStatusBadge(to).label}»`}
            </button>
          );
        })}
      </div>

      {next.includes(ORDER_STATUSES.CANCELLED) && (
        <p className="text-warning mt-4 flex items-start gap-1.5 text-xs">
          <AlertCircle
            size={12}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          لغو سفارش موجودی اقلام را برمی‌گرداند؛ اگر پرداخت انجام شده باشد
          بازپرداخت دستی لازم است.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="text-destructive bg-destructive-soft mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
        >
          <AlertCircle size={16} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
