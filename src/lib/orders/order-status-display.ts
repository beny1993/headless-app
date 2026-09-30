// The Persian labels and badge tokens for order and payment statuses — the
// account orders tab and the customer order-detail page render these, and the
// admin orders story will reuse them.
//
// Client-safe: it imports only the status vocabulary (`order-status.ts`), no
// drizzle / `pg`, so a `'use client'` component can import it. Kept separate from
// `order-status.ts`, which stays pure domain + transition rules — this is display
// config, mapped exhaustively so a status added later fails the compile here
// (the `Record<…, …>` type forces every member) rather than rendering blank.
//
// Badge classes are the design's tokens, all defined in `src/app/globals.css`.
import {
  type OrderStatus,
  ORDER_STATUSES,
  type PaymentStatus,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';

type StatusBadge = { label: string; badge: string };

const ORDER_STATUS_DISPLAY: Record<OrderStatus, StatusBadge> = {
  [ORDER_STATUSES.PENDING_PAYMENT]: {
    label: 'در انتظار پرداخت',
    badge: 'bg-warning-soft text-warning',
  },
  // Not «…پرداخت»: the Zarinpal badge and heading say that, and a locator —
  // or a shopper — must never mistake one wait for the other.
  [ORDER_STATUSES.AWAITING_RECEIPT]: {
    label: 'در انتظار رسید واریز',
    badge: 'bg-warning-soft text-warning',
  },
  [ORDER_STATUSES.PAID]: {
    label: 'پرداخت شده',
    badge: 'bg-info-soft text-info',
  },
  [ORDER_STATUSES.PROCESSING]: {
    label: 'در حال پردازش',
    badge: 'bg-tan-soft text-tan-strong',
  },
  [ORDER_STATUSES.SHIPPED]: {
    label: 'ارسال شده',
    badge: 'bg-accent-soft text-accent-hover',
  },
  [ORDER_STATUSES.DELIVERED]: {
    label: 'تحویل شده',
    badge: 'bg-success-soft text-success-strong',
  },
  [ORDER_STATUSES.CANCELLED]: {
    label: 'لغو شده',
    badge: 'bg-destructive-soft text-destructive',
  },
  [ORDER_STATUSES.FAILED]: {
    label: 'ناموفق',
    badge: 'bg-muted text-muted-foreground',
  },
};

const PAYMENT_STATUS_DISPLAY: Record<PaymentStatus, StatusBadge> = {
  [PAYMENT_STATUSES.PENDING]: {
    label: 'در انتظار پرداخت',
    badge: 'bg-warning-soft text-warning',
  },
  [PAYMENT_STATUSES.PAID]: {
    label: 'پرداخت شده',
    badge: 'bg-success-soft text-success-strong',
  },
  [PAYMENT_STATUSES.FAILED]: {
    label: 'ناموفق',
    badge: 'bg-destructive-soft text-destructive',
  },
};

/** The Persian label + badge classes for an order status. */
export const orderStatusBadge = (status: OrderStatus): StatusBadge =>
  ORDER_STATUS_DISPLAY[status];

/** The Persian label + badge classes for a payment status. */
export const paymentStatusBadge = (status: PaymentStatus): StatusBadge =>
  PAYMENT_STATUS_DISPLAY[status];
