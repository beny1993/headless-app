'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { postData } from '@/lib/api-client';
import { reasonFrom } from '@/lib/checkout/field-errors';
import { apiAdminOrderTransitionsPath } from '@/lib/constant/paths';
import {
  adminNextStatuses,
  adminTransitionBodySchema,
  CANCELLATION_REASON_MAX,
  CANCELLATION_REASON_REQUIRED_MESSAGE,
  ORDER_STATUSES,
  type AdminTransitionBody,
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
 * component-test rule guards; keeping only `busy` local avoids it; a refused
 * transition is an error toast, not state.)
 *
 * `busy` is cleared in `finally`, not left set on success: `router.refresh()`
 * updates the server tree but PRESERVES this client component's state (it does
 * not remount), so a lingering `busy` would render the next status's buttons
 * disabled and strand the order. The brief enabled window before the refresh
 * lands is safe — a duplicate transition hits the CAS and answers 409.
 *
 * The server still rejects an illegal or stale transition (400/409); this only
 * decides what to *offer*. A terminal order offers nothing.
 *
 * A cancel needs a reason — the shopper reads it on their order — so the cancel
 * button opens a field instead of sending. The reason is checked against the
 * same `adminTransitionBodySchema` the route validates (the bidi and length
 * rules, a blank field read as no reason); the server's `reason_required` is
 * the rule, this is the courtesy.
 */
export function OrderTransition({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const router = useRouter();
  const formId = useId();
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonField = useRef<HTMLInputElement>(null);

  const next = adminNextStatuses(status);
  const canCancel = next.includes(ORDER_STATUSES.CANCELLED);

  if (next.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Check size={14} className="text-success-strong" aria-hidden="true" />
        این سفارش در وضعیت نهایی «{orderStatusBadge(status).label}» است و تغییر
        دیگری ندارد.
      </p>
    );
  }

  const move = async (body: AdminTransitionBody) => {
    const { to } = body;
    setBusy(to);
    try {
      await postData(apiAdminOrderTransitionsPath(orderId), body);
      // The server is now authoritative; re-render from it rather than tracking
      // the new status locally.
      router.refresh();
    } catch (requestError) {
      toast.error(
        reasonFrom(requestError) ??
          'تغییر وضعیت سفارش ناموفق بود. دوباره تلاش کن.',
      );
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = adminTransitionBodySchema.safeParse({
      to: ORDER_STATUSES.CANCELLED,
      reason,
    });
    const refusal = !parsed.success
      ? (parsed.error.issues[0]?.message ??
        CANCELLATION_REASON_REQUIRED_MESSAGE)
      : !parsed.data.reason
        ? CANCELLATION_REASON_REQUIRED_MESSAGE
        : null;
    // Committed before focus moves: by the time focus lands back on the field,
    // it is already `aria-invalid` and described by the refusal.
    flushSync(() => setReasonError(refusal));
    if (refusal) reasonField.current?.focus();
    if (parsed.success && !refusal) await move(parsed.data);
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
              // A cancel asks for its reason first; every other move goes.
              onClick={() =>
                isCancel ? setCancelling((open) => !open) : move({ to })
              }
              disabled={busy !== null}
              aria-expanded={isCancel ? cancelling : undefined}
              aria-controls={isCancel ? formId : undefined}
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

      {canCancel && cancelling && (
        <form
          id={formId}
          onSubmit={cancel}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`${formId}-reason`}
              className="mb-1.5 block text-sm font-medium"
            >
              دلیل لغو
            </label>
            <input
              ref={reasonField}
              id={`${formId}-reason`}
              name="reason"
              type="text"
              autoComplete="off"
              spellCheck
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={CANCELLATION_REASON_MAX}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${formId}-error` : undefined}
              data-umami-event="admin-panel-order-cancel-reason"
              className="border-border focus-visible:border-accent-strong focus-visible:ring-ring w-full rounded-xl border-2 px-4 py-2.5 text-sm outline-none focus-visible:ring-2"
            />
          </div>
          <button
            type="submit"
            disabled={busy !== null}
            data-umami-event="admin-panel-order-cancel-submit"
            className="border-destructive/40 text-destructive hover:bg-destructive-soft inline-flex items-center gap-2 rounded-xl border-2 px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            ثبت لغو
          </button>
          {reasonError && (
            <p
              id={`${formId}-error`}
              role="alert"
              className="text-destructive w-full text-xs"
            >
              {reasonError}
            </p>
          )}
        </form>
      )}

      {canCancel && (
        <p className="text-warning mt-4 flex items-start gap-1.5 text-xs">
          <AlertCircle
            size={12}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          لغو سفارش موجودی اقلام را برمی‌گرداند؛ اگر پرداخت انجام شده باشد
          بازپرداخت دستی لازم است. دلیل برای مشتری نمایش داده می‌شود.
        </p>
      )}
    </div>
  );
}
