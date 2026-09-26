// The admin's single order-status write path. It does NOT reinvent the machine:
// it reads the order's current status and drives the existing `transitionOrder`
// CAS (state-machine.ts), which is the only thing that may `UPDATE orders SET
// status`. Two guards, in order:
//   1. `adminNextStatuses(from)` — the target must be one an admin may trigger
//      (the machine's legal edges minus the gateway-owned `paid`/`failed`). This
//      is what stops an operator booking money the gateway never confirmed, and
//      it is enforced HERE on the server, not merely hidden in the UI.
//   2. the CAS itself — `WHERE status = from` — makes the move race-safe: if the
//      order moved between the read and the write (another admin, a verify), the
//      CAS matches nothing and `transitionOrder` throws, surfaced as a conflict.
//
// Owns the transaction (the state machine delegates the boundary to its caller),
// exactly like verify.ts and reconcile.ts. Returns a discriminated outcome so the
// route maps each to its own status code without catching control-flow as errors.
import { db } from '@/db';
import { OrderDao } from '@/db/dao/OrderDao';
import { adminNextStatuses, type OrderStatus } from '@/lib/orders/order-status';
import {
  InvalidTransitionError,
  transitionOrder,
} from '@/logic/orders/state-machine';

type AdminTransitionResult =
  | { outcome: 'ok' }
  /** No order with that id. */
  | { outcome: 'not_found' }
  /** The target is not an admin-triggerable next state from `from`. */
  | { outcome: 'illegal'; from: OrderStatus }
  /** The order moved out of `from` before the CAS ran (lost race / stale view). */
  | { outcome: 'conflict' };

/**
 * Move order `orderId` to `to` on the admin's behalf. All side effects of the
 * transition (restock on cancel, the COD payment flip on delivery) happen inside
 * the same transaction as the CAS, via `transitionOrder`.
 *
 * A `markCodPaid`-style data-corruption error is deliberately NOT folded into a
 * `conflict`: it is not an InvalidTransitionError, so it propagates and the route
 * lets it be the 500 it is, rather than masking corruption as a benign race.
 */
export const adminTransitionOrder = async (
  orderId: string,
  to: OrderStatus,
): Promise<AdminTransitionResult> => {
  try {
    return await db.transaction(async (tx) => {
      const from = await OrderDao.getStatus(tx, orderId);
      if (!from) return { outcome: 'not_found' as const };
      if (!adminNextStatuses(from).includes(to)) {
        return { outcome: 'illegal' as const, from };
      }
      await transitionOrder(tx, orderId, from, to);
      return { outcome: 'ok' as const };
    });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return { outcome: 'conflict' };
    }
    throw error;
  }
};
