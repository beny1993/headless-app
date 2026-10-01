import { apiAdminOrderReceiptPath } from '@/lib/constant/paths';
import { formatJalaliDateTime, formatNumber } from '@/lib/format';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/orders/order-status';
import { receiptsLabel } from '@/lib/orders/receipt';
import type { AdminReceipt } from '@/logic/orders/get-admin-order';

/**
 * A card-to-card order's receipts, where the admin checks them before shipping
 * — or cancels, with a reason. Server-rendered: each thumbnail is the receipt
 * itself through the admin's authenticated route (a plain `<img>`, never
 * `next/image`, whose optimizer would fetch it without the admin's session and
 * cache it), opening full size in a new tab.
 */
export function OrderReceipts({
  orderId,
  status,
  receipts,
}: {
  orderId: string;
  status: OrderStatus;
  receipts: AdminReceipt[];
}) {
  return (
    <section className="border-border rounded-2xl border bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">رسیدهای پرداخت</h2>
        {receipts.length > 0 && (
          <span className="bg-secondary rounded-full px-2.5 py-1 text-xs font-medium">
            {receiptsLabel(status)}
          </span>
        )}
      </div>

      {receipts.length === 0 ? (
        <>
          <p className="text-muted-foreground text-sm">
            رسیدی در سایت بارگذاری نشده است.
          </p>
          {status === ORDER_STATUSES.AWAITING_RECEIPT && (
            <p className="text-muted-foreground mt-1 text-xs">
              اگر رسید را در پیام گرفتی، سفارش را به «در حال پردازش» ببر.
            </p>
          )}
        </>
      ) : (
        <ul className="flex flex-wrap gap-4">
          {receipts.map((receipt) => {
            const url = apiAdminOrderReceiptPath(orderId, receipt.id);
            return (
              <li key={receipt.id} className="w-28">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  data-umami-event="admin-panel-order-receipt-open"
                  className="border-border block overflow-hidden rounded-xl border"
                >
                  {/* The app's own authenticated route, not the bucket the
                      lint rule guards against. */}
                  {/* eslint-disable-next-line no-restricted-syntax */}
                  <img
                    src={url}
                    alt="رسید پرداخت"
                    loading="lazy"
                    className="size-28 object-cover"
                  />
                </a>
                <p className="text-muted-foreground nums mt-1 text-xs">
                  {formatJalaliDateTime(receipt.createdAt)}
                </p>
                <p className="text-muted-foreground nums text-xs">
                  {formatNumber(Math.ceil(receipt.size / 1024))} کیلوبایت
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
