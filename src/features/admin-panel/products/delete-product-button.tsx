'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { delData } from '@/lib/api-client';
import { apiAdminProductPath } from '@/lib/constant/paths';

/**
 * Soft-deletes (deactivates) a product. It does not remove the row — the API
 * only flips `is_active` so past order snapshots stay intact — so after a
 * refresh the product is still listed, now marked غیرفعال. The confirm copy
 * says exactly that, so "delete" is never mistaken for a hard delete.
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
    } catch {
      setBusy(false);
      window.alert('غیرفعال کردن محصول ناموفق بود. دوباره تلاش کن.');
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
