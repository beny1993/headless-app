'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiRequestError, delData } from '@/lib/api-client';
import { apiAdminProductPath } from '@/lib/constant/paths';

/**
 * Soft-deletes (deactivates) a product. It does not remove the row — the API
 * only flips `is_active` so past order snapshots stay intact — so after a
 * refresh the product is still listed, now marked غیرفعال, and the list stops
 * offering this button on it. The confirm copy says exactly that, so "delete" is
 * never mistaken for a hard delete. A failure is an error toast.
 */
export function DeleteProductButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const deactivate = async () => {
    if (
      !window.confirm(
        `«${title}» از فروشگاه پنهان می‌شود (غیرفعال). سفارش‌های قبلی دست‌نخورده می‌مانند. ادامه؟`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await delData(apiAdminProductPath(id));
      router.refresh();
    } catch (error) {
      setBusy(false);
      // Only the server's own sentence — `ApiRequestError` carries the envelope
      // `message`, which for a family head names how many members are in the
      // way and is already Persian. Every other rejection is a transport
      // failure whose message is an internal English string, and there
      // «try again» is exactly the right advice.
      toast.error(
        error instanceof ApiRequestError && error.message
          ? error.message
          : 'غیرفعال کردن محصول ناموفق بود. دوباره تلاش کن.',
      );
    }
  };

  return (
    <button
      type="button"
      onClick={deactivate}
      disabled={busy}
      aria-label={`غیرفعال کردن ${title}`}
      data-umami-event="admin-panel-products-delete"
      className="text-destructive hover:bg-destructive-soft flex h-10 w-10 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      ) : (
        <Trash2 size={14} aria-hidden="true" />
      )}
    </button>
  );
}
