import Image from 'next/image';
import Link from 'next/link';
import { Edit, Eye } from 'lucide-react';
import type { ProductWithImages } from '@/db/schema/catalog';
import type { HardDeleteBlocker } from '@/lib/catalog/product-delete';
import { displayTitle } from '@/lib/catalog/variant';
import { adminEditProductPath, productPath } from '@/lib/constant/paths';
import { formatNumber, formatToman } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';
import { Pill } from '@/features/admin-panel/shared/pill';
import { DeleteProductButton } from './delete-product-button';
import { StockBadge } from './stock-badge';

/** One row of the admin product table. A server component, like its page. */
export function ProductRow({
  product,
  categoryTitle,
  rowNumber,
  deleteBlocker,
}: {
  product: ProductWithImages;
  categoryTitle: string;
  /** The row's place in the whole filtered list, counting from one. */
  rowNumber: number;
  /** What keeps this product from a real delete; `null` when nothing does. */
  deleteBlocker: HardDeleteBlocker | null;
}) {
  const imageKey = product.images[0]?.objectKey;
  return (
    <tr className="border-border hover:bg-secondary/20 border-t transition-colors">
      <td className="text-muted-foreground nums px-4 py-3 text-xs">
        {formatNumber(rowNumber)}
      </td>
      <td className="px-4 py-3">
        <div className="bg-muted relative h-10 w-10 overflow-hidden rounded-lg">
          {imageKey && (
            <Image
              src={imageSrc(imageKey)}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          )}
        </div>
      </td>
      <td className="max-w-xs px-4 py-3 font-medium">
        {/* `displayTitle`, so the 10kg bag is findable and distinguishable
            from the 5kg one — the list shows every row, members included. */}
        <p className="line-clamp-2">{displayTitle(product)}</p>
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {product.brand ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs">{categoryTitle}</td>
      <td className="px-4 py-3 text-xs font-semibold">
        {formatToman(product.price)}
      </td>
      <td className="px-4 py-3">
        <StockBadge stock={product.stock} />
      </td>
      <td className="px-4 py-3">
        <Pill tone={product.isActive ? 'success' : 'muted'}>
          {product.isActive ? 'فعال' : 'غیرفعال'}
        </Pill>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Link
            href={productPath(product.slug)}
            // `displayTitle` on every control in the row: the members of a
            // family share one `title`, so plain titles give three rows three
            // identically-named buttons — indistinguishable to a screen reader
            // and to anyone trying to edit the 10kg rather than the 5kg.
            aria-label={`مشاهده ${displayTitle(product)} در فروشگاه`}
            className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          >
            <Eye size={14} aria-hidden="true" />
          </Link>
          <Link
            href={adminEditProductPath(product.id)}
            aria-label={`ویرایش ${displayTitle(product)}`}
            data-umami-event="admin-panel-products-edit"
            className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          >
            <Edit size={14} aria-hidden="true" />
          </Link>
          {/* An active product can always go: deleted if nothing references
              it, else deactivated. An inactive one only when it can really be
              deleted — one with orders or members has nothing left to
              deactivate, and reactivating is the edit form's checkbox. */}
          {(product.isActive || deleteBlocker === null) && (
            <DeleteProductButton
              id={product.id}
              title={displayTitle(product)}
              blocker={deleteBlocker}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
