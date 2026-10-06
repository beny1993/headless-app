// The background sweeps that release the stock abandoned orders hold, run every
// SWEEP_INTERVAL_MS inside the server itself — started once per process from
// `register()` in src/instrumentation.ts, so production, staging and `pnpm dev`
// all run them with nothing to configure:
//   · card-to-card orders past their receipt wait are cancelled
//     (`expireReceiptOrders`);
//   · while online payment is on, the Zarinpal reconcile verifies stale
//     attempts and expires unpaid orders (`reconcilePayments`). With it off
//     there is nothing to sweep, and a mock driver in a production build
//     refuses to run at all.
//
// Every order moves through the state machine's CAS, so two processes sweeping
// at once — a rolling deploy's overlap, a second replica — cancel each order
// once. A failing sweep is reported and the next run retries; it never takes
// the server down.
import * as Sentry from '@sentry/nextjs';
import { getEnvFlag, VARS } from '@/lib/utils/env';
import { expireReceiptOrders } from '@/logic/orders/expire-receipt-orders';
import { reconcilePayments } from '@/logic/payments/reconcile';

const MINUTE_MS = 60 * 1000;

/** Every five minutes: a card-to-card order's half-hour wait ends within 35. */
export const SWEEP_INTERVAL_MS = 5 * MINUTE_MS;

/**
 * The first run's wait after start, longer than the interval: a sweep racing
 * the E2E suite's seed (which resets the catalog's stock as the server starts)
 * would restock a killed run's leftover orders behind it.
 */
export const FIRST_SWEEP_DELAY_MS = 15 * MINUTE_MS;

const sweep = async (name: string, run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    Sentry.captureException(error);
    console.error(`[sweep] ${name} failed; the next run retries`, error);
  }
};

/** One run of every sweep, each isolated from the other's failure. */
export async function runOrderSweeps(): Promise<void> {
  await sweep('receipt expiry', async () => {
    const expired = await expireReceiptOrders();
    if (expired > 0) {
      console.log(
        `[sweep] cancelled ${expired} card-to-card order(s) past their receipt wait`,
      );
    }
  });
  if (getEnvFlag(VARS.APP_CONFIG_ZARINPAL_ENABLED)) {
    await sweep('zarinpal reconcile', async () => {
      const result = await reconcilePayments();
      if (Object.values(result).some((count) => count > 0)) {
        console.log('[sweep] zarinpal reconcile', result);
      }
    });
  }
}

// On globalThis, not in this module: a dev server re-evaluating the module
// must not stack a second schedule beside the first.
const STARTED = Symbol.for('smokey-shop.order-sweeps');

/**
 * Starts the schedule, once per process: the first run FIRST_SWEEP_DELAY_MS
 * after start, never at boot, then every SWEEP_INTERVAL_MS. `unref`, so the
 * schedule never keeps a process alive on its own.
 */
export function startOrderSweeps(): void {
  const scope = globalThis as typeof globalThis & { [STARTED]?: true };
  if (scope[STARTED]) return;
  scope[STARTED] = true;
  setTimeout(() => {
    void runOrderSweeps();
    setInterval(() => void runOrderSweeps(), SWEEP_INTERVAL_MS).unref?.();
  }, FIRST_SWEEP_DELAY_MS).unref?.();
}
