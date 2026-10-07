// The admin's 🗑: delete a product for real when nothing references it, else
// deactivate it as before. It reads `OrderDao` (is it on an order line?) and
// writes through `ProductDao`, hence src/logic/.
//
// The caller passes what the admin confirmed, and this never does more: a
// `deactivate` only ever deactivates, even for a product that could now be
// deleted. A `delete` still has to be decided again, because both references
// restrict — `order_items.product_id` and `products.variant_of` — and the
// decision has to be made where it cannot go stale: in one
// transaction, under the product's own `FOR UPDATE` lock. An order-line or
// member insert's foreign-key check takes `FOR KEY SHARE` on the product, which
// waits on this lock, and a member write through `ProductDao` also takes
// `FOR UPDATE` on its head first (`assertFamilyRules`). Should the delete still
// hit a 23503, `ProductDao.hardDelete` rolls back
// to its savepoint and this deactivates instead; it never surfaces as a 500.
//
// Files go only after the commit, and only the keys the delete itself took.
import { db, type Executor } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  DELETE_INTENTS,
  DELETE_OUTCOMES,
  HARD_DELETE_BLOCKERS,
  type DeleteIntent,
  type DeleteOutcome,
  type HardDeleteBlocker,
} from '@/lib/catalog/product-delete';
import { getStorageDriver } from '@/lib/storage';
import { deleteQuietly, isOurUpload } from './product-images';

/**
 * What keeps each of `ids` from being deleted; an id that is absent can be.
 * An order outranks members: members can be moved, an order line never goes.
 * Two queries for the whole list, whatever its length — the admin list calls
 * this once per page.
 */
export async function hardDeleteBlockers(
  ids: readonly string[],
  executor: Executor = db,
): Promise<Map<string, HardDeleteBlocker>> {
  const blockers = new Map<string, HardDeleteBlocker>();
  if (ids.length === 0) return blockers;
  const ordered = await OrderDao.orderedProductIds(executor, ids);
  const heads = await ProductDao.idsWithMembers(executor, ids);
  for (const id of ids) {
    if (ordered.has(id)) blockers.set(id, HARD_DELETE_BLOCKERS.ORDERS);
    else if (heads.has(id)) blockers.set(id, HARD_DELETE_BLOCKERS.MEMBERS);
  }
  return blockers;
}

/**
 * Deletes the product when the admin confirmed a delete and nothing references
 * it; otherwise deactivates it. Says which. `null` for an unknown id. A head
 * with active members is refused with `ProductVariantError` for either intent,
 * exactly as the soft delete always refused it.
 */
export async function removeProduct(
  id: string,
  intent: DeleteIntent,
): Promise<DeleteOutcome | null> {
  const removed = await db.transaction(async (tx) => {
    if (!(await ProductDao.lockRow(tx, id))) return null;

    if (
      intent === DELETE_INTENTS.DELETE &&
      !(await hardDeleteBlockers([id], tx)).has(id)
    ) {
      const keys = await ProductDao.hardDelete(tx, id);
      if (keys) return { outcome: DELETE_OUTCOMES.DELETED, keys };
    }

    await ProductDao.deactivate(tx, id);
    return { outcome: DELETE_OUTCOMES.DEACTIVATED, keys: [] };
  });
  if (!removed) return null;

  const uploads = removed.keys.filter(isOurUpload);
  if (uploads.length > 0) {
    const driver = getStorageDriver();
    for (const key of uploads) await deleteQuietly(driver, key);
  }
  return removed.outcome;
}
