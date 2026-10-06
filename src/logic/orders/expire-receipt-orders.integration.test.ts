// Needs a live database — see src/db/test-db.ts. A card-to-card order whose
// receipt has not arrived within RECEIPT_WAIT_MS is cancelled by the sweep,
// its stock returned and the reason the shopper reads stored; a younger one,
// or one its receipt already accepted, is left alone. `now` is passed in, so
// "half an hour later" needs no clock. An order that fails is reported with
// its id and the rest still expire.
//
// The worklist is narrowed to this suite's own orders: the dev database is
// shared, and a clock pushed past the wait would cancel everyone's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { expireReceiptOrders, RECEIPT_EXPIRED_REASON, RECEIPT_WAIT_MS } =
  await importWithDb(() => import('@/logic/orders/expire-receipt-orders'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }));

describe.skipIf(!databaseReachable)('expireReceiptOrders', () => {
  const fx = new OrderFixtures();
  beforeEach(() => {
    const real = OrderDao.listAwaitingReceiptBefore.bind(OrderDao);
    vi.spyOn(OrderDao, 'listAwaitingReceiptBefore').mockImplementation(
      async (cutoff) =>
        (await real(cutoff)).filter((id) => fx.orderIds.includes(id)),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.captureException.mockReset();
    return fx.cleanup();
  });

  const placed = async (status: OrderStatus) => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), { stock: 3 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        status,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { product, order };
  };
  const stockOf = async (id: string) =>
    (await ProductDao.getByIds(testDb, [id]))[0].stock;
  /** The sweep's clock, just past the wait for an order created now. */
  const later = () => Date.now() + RECEIPT_WAIT_MS + 60_000;

  it('waits half an hour, and says so in minutes', () => {
    // Benyamin's call: a held last unit is free again within the half hour.
    expect(RECEIPT_WAIT_MS).toBe(30 * 60 * 1000);
    expect(RECEIPT_EXPIRED_REASON).toBe('رسید پرداخت در مهلت ۳۰ دقیقه نرسید');
  });

  it('cancels an order whose receipt never came, returns its stock and says why', async () => {
    const { product, order } = await placed(ORDER_STATUSES.AWAITING_RECEIPT);

    expect(await expireReceiptOrders(later())).toBeGreaterThanOrEqual(1);

    const after = await OrderDao.getById(order.id);
    expect(after?.status).toBe(ORDER_STATUSES.CANCELLED);
    expect(after?.cancellationReason).toBe(RECEIPT_EXPIRED_REASON);
    expect(await stockOf(product.id)).toBe(3 + 2);
  });

  it('leaves an order still inside its wait', async () => {
    const { product, order } = await placed(ORDER_STATUSES.AWAITING_RECEIPT);

    await expireReceiptOrders(Date.now() + RECEIPT_WAIT_MS - 60_000);

    expect((await OrderDao.getById(order.id))?.status).toBe(
      ORDER_STATUSES.AWAITING_RECEIPT,
    );
    expect(await stockOf(product.id)).toBe(3);
  });

  it.each([ORDER_STATUSES.PROCESSING, ORDER_STATUSES.PENDING_PAYMENT])(
    'leaves an old %s order alone',
    async (status) => {
      const { order } = await placed(status);

      await expireReceiptOrders(later());

      expect((await OrderDao.getById(order.id))?.status).toBe(status);
    },
  );

  it('reports an order that fails with its id, and still expires the rest', async () => {
    const poisoned = await placed(ORDER_STATUSES.AWAITING_RECEIPT);
    const healthy = await placed(ORDER_STATUSES.AWAITING_RECEIPT);
    const failure = new Error('corrupt row');
    const realCas = OrderDao.casStatus.bind(OrderDao);
    vi.spyOn(OrderDao, 'casStatus').mockImplementation((tx, id, ...rest) =>
      id === poisoned.order.id
        ? Promise.reject(failure)
        : realCas(tx, id, ...rest),
    );

    expect(await expireReceiptOrders(later())).toBe(1);

    expect((await OrderDao.getById(healthy.order.id))?.status).toBe(
      ORDER_STATUSES.CANCELLED,
    );
    expect((await OrderDao.getById(poisoned.order.id))?.status).toBe(
      ORDER_STATUSES.AWAITING_RECEIPT,
    );
    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      extra: { orderId: poisoned.order.id },
    });
  });
});
