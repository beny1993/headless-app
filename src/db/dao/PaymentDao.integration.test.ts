// Needs a live database — see src/db/test-db.ts. The authority-uniqueness and
// amount constraints are enforced by Postgres, so they can only be proven here.
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { payments, type OrderWithItems } from '@/db/schema/orders';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { db } = await importWithDb(() => import('@/db'));

describe.skipIf(!databaseReachable)('PaymentDao', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const orderFor = async (): Promise<OrderWithItems> => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(fx.buildOrder(user, [{ product }]));
    fx.remember(order.id);
    return order;
  };

  const refusedBy = async (
    run: () => Promise<unknown>,
  ): Promise<string | undefined> => {
    try {
      await run();
      return undefined;
    } catch (error) {
      return (error as { cause?: { constraint?: string } }).cause?.constraint;
    }
  };

  it('stores a Zarinpal attempt and finds it by authority', async () => {
    const order = await orderFor();
    const authority = `A-${crypto.randomUUID()}`;

    const created = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority,
    });

    expect(created.status).toBe(PAYMENT_STATUSES.PENDING); // column default
    const found = await PaymentDao.getByAuthority(authority);
    expect(found?.id).toBe(created.id);
  });

  it('rejects a second row with the same authority — the idempotency anchor', async () => {
    const order = await orderFor();
    const authority = `A-${crypto.randomUUID()}`;
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority,
    });

    const refused = await refusedBy(() =>
      PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.ZARINPAL,
        amount: order.total,
        authority,
      }),
    );

    expect(refused).toBe('payments_authority_unique');
  });

  it('allows many COD rows with a null authority (unique permits repeated NULLs)', async () => {
    const first = await orderFor();
    const second = await orderFor();

    const a = await PaymentDao.create({
      orderId: first.id,
      method: PAYMENT_METHODS.COD,
      amount: first.total,
    });
    const b = await PaymentDao.create({
      orderId: second.id,
      method: PAYMENT_METHODS.COD,
      amount: second.total,
    });

    expect(a.authority).toBeNull();
    expect(b.authority).toBeNull();
  });

  it('rejects a second COD row on the same order — the at-most-one-COD anchor', async () => {
    // The COD twin of the authority idempotency: without the partial unique
    // index a checkout bug or double-submit could plant a second COD row, and
    // the order would hold two payments for its one transfer, both flipped paid
    // by markCodPaid when it ships. The DB refuses the second write instead. (COD has no
    // authority, so the null-authority column cannot carry this — the many-NULLs
    // test above is on *different* orders and stays green.)
    const order = await orderFor();
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      amount: order.total,
    });

    const refused = await refusedBy(() =>
      PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.COD,
        amount: order.total,
      }),
    );

    expect(refused).toBe('payments_one_cod_per_order');
  });

  it('lists every attempt on an order', async () => {
    const order = await orderFor();
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });

    expect(await PaymentDao.listByOrder(order.id)).toHaveLength(2);
  });

  it('lists attempts oldest first, deterministically', async () => {
    const order = await orderFor();
    // Insertion order and createdAt order are made to DISAGREE: the row created
    // second is back-dated to be the older attempt. A read without ORDER BY
    // returns heap/insertion order and fails; the createdAt-asc order must win.
    const first = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });
    const second = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });
    await db
      .update(payments)
      .set({ createdAt: new Date(first.createdAt.getTime() - 60_000) })
      .where(eq(payments.id, second.id));

    const ids = (await PaymentDao.listByOrder(order.id)).map((p) => p.id);
    expect(ids).toEqual([second.id, first.id]);
    // Stable across requests — the property the customer-facing read needs.
    const again = (await PaymentDao.listByOrder(order.id)).map((p) => p.id);
    expect(again).toEqual([second.id, first.id]);
  });

  it('rejects a negative amount but allows zero (a fully-discounted order)', async () => {
    const order = await orderFor();

    const refused = await refusedBy(() =>
      PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.COD,
        amount: -1,
      }),
    );
    expect(refused).toBe('payments_amount_non_negative');

    const zero = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      amount: 0,
    });
    expect(zero.amount).toBe(0);
  });

  // ── The verify-path CAS guards ──────────────────────────────────────────────

  const pendingZarinpalAttempt = async () => {
    const order = await orderFor();
    return PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });
  };

  const paidFields = () => ({
    refId: 'ref-1',
    cardPan: null,
    gatewayResponse: { verify: true },
    paidAt: new Date(),
  });

  it('markPaid flips a pending attempt to paid and records the ref', async () => {
    const attempt = await pendingZarinpalAttempt();

    const paid = await db.transaction((tx) =>
      PaymentDao.markPaid(tx, attempt.id, paidFields()),
    );

    expect(paid?.status).toBe(PAYMENT_STATUSES.PAID);
    expect(paid?.refId).toBe('ref-1');
    expect(paid?.paidAt).not.toBeNull();
  });

  it('markPaid is idempotent on an already-paid row (returns null, no overwrite)', async () => {
    const attempt = await pendingZarinpalAttempt();
    await db.transaction((tx) =>
      PaymentDao.markPaid(tx, attempt.id, paidFields()),
    );

    const second = await db.transaction((tx) =>
      PaymentDao.markPaid(tx, attempt.id, {
        ...paidFields(),
        refId: 'ref-2', // a different ref must NOT overwrite the first
      }),
    );

    expect(second).toBeNull();
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, attempt.id));
    expect(row.refId).toBe('ref-1');
  });

  it('markPaid CAS is <> paid, not = pending: a failed row can still be paid', async () => {
    // The money-safety guard: a reconcile that marked an attempt failed too early
    // must still be settleable by a genuine later verify-OK.
    const attempt = await pendingZarinpalAttempt();
    await PaymentDao.markFailed(db, attempt.id, {
      failureReason: 'verified as unpaid, too early',
      gatewayResponse: null,
    });

    const paid = await db.transaction((tx) =>
      PaymentDao.markPaid(tx, attempt.id, paidFields()),
    );

    expect(paid?.status).toBe(PAYMENT_STATUSES.PAID);
  });

  it('markFailed flips a pending attempt to failed', async () => {
    const attempt = await pendingZarinpalAttempt();

    const failed = await PaymentDao.markFailed(db, attempt.id, {
      failureReason: 'user cancelled',
      gatewayResponse: { status: 'NOK' },
    });

    expect(failed?.status).toBe(PAYMENT_STATUSES.FAILED);
    expect(failed?.failureReason).toBe('user cancelled');
  });

  it('markFailed never un-pays a paid row (CAS = pending; returns null)', async () => {
    const attempt = await pendingZarinpalAttempt();
    await db.transaction((tx) =>
      PaymentDao.markPaid(tx, attempt.id, paidFields()),
    );

    const result = await PaymentDao.markFailed(db, attempt.id, {
      failureReason: 'a late NOK must not un-pay',
      gatewayResponse: null,
    });

    expect(result).toBeNull();
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, attempt.id));
    expect(row.status).toBe(PAYMENT_STATUSES.PAID); // still paid
  });

  it('listPendingWithAuthorityOlderThan returns only old, pending, authority-bearing rows', async () => {
    const fresh = await pendingZarinpalAttempt(); // pending, but created now
    const old = await pendingZarinpalAttempt();
    const codOrder = await orderFor();
    const cod = await PaymentDao.create({
      orderId: codOrder.id,
      method: PAYMENT_METHODS.COD,
      amount: codOrder.total,
    });
    // Back-date the old zarinpal row AND the COD row well past the cutoff.
    const long = new Date(Date.now() - 60 * 60_000);
    await db
      .update(payments)
      .set({ createdAt: long })
      .where(eq(payments.id, old.id));
    await db
      .update(payments)
      .set({ createdAt: long })
      .where(eq(payments.id, cod.id));

    const cutoff = new Date(Date.now() - 15 * 60_000);
    const ids = (
      await PaymentDao.listPendingWithAuthorityOlderThan(cutoff)
    ).map((p) => p.id);

    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id); // too fresh
    expect(ids).not.toContain(cod.id); // no authority
  });
});
