// WHAT the admins get, and what a failing provider may cost the caller: nothing.
//
// The real notify runs here against the real DAOs; only the SMS seam is mocked,
// at its module edge (`sendSms`), so the recipient list and the message are the
// ones production would produce. The send is un-awaited by design, so it is
// observed with `vi.waitFor` — never a sleep.
//
// Needs a live database — see src/db/test-db.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { orders, payments } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { ROLES, users } from '@/db/schema/auth';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { toPersianDigits, formatToman } from '@/lib/format';
import type { ZarinpalClient } from '@/lib/zarinpal/client';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const mocks = vi.hoisted(() => ({
  sendSms: vi.fn(),
  captureException: vi.fn(),
}));

// The module edge, not the logic under test: everything above `sendSms` — the
// recipient query, the builder, the fire-and-forget — runs for real.
vi.mock('@/lib/sms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sms')>()),
  sendSms: mocks.sendSms,
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
}));

const { createOrder } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { settlePendingPayment } = await importWithDb(
  () => import('@/logic/payments/verify'),
);
const { newOrderAlert } = await importWithDb(
  () => import('@/logic/orders/notify-new-order'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { UserDao } = await importWithDb(() => import('@/db/dao/UserDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);
const phone = () =>
  `+98991${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

const stubClient = (): ZarinpalClient => ({
  requestPayment: async () => ({ authority: 'unused', redirectUrl: 'unused' }),
  verifyPayment: async () => ({
    ok: true,
    refId: 'ref-100',
    cardPan: '502229******5995',
    alreadyVerified: false,
  }),
});

describe.skipIf(!databaseReachable)('the new-order alert', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];
  const adminIds: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendSms.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
    if (provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, provinceIds));
      await testDb.delete(provinces).where(inArray(provinces.id, provinceIds));
      provinceIds.length = 0;
    }
    if (adminIds.length > 0) {
      await testDb.delete(users).where(inArray(users.id, adminIds));
      adminIds.length = 0;
    }
  });

  /** A staff account, with or without a number to reach it on. */
  const admin = async (phoneNumber: string | null = phone()) => {
    const t = token();
    const [row] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: 'مدیر آزمایشی',
        email: `alert-${t}@example.com`,
        role: ROLES.ADMIN,
        phoneNumber,
      })
      .returning();
    adminIds.push(row.id);
    return row;
  };

  const province = async (fee = 50_000) => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee,
    });
    provinceIds.push(row.provinceId);
    return row;
  };

  const checkout = async (overrides: Partial<CheckoutInput> = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { price: 100_000, stock: 5 });
    const prov = await province(40_000);
    const input: CheckoutInput = {
      items: [{ productId: product.id, qty: 2 }],
      address: {
        recipientName: 'گیرنده آزمایشی',
        recipientPhone: '09120000000',
        provinceId: prov.provinceId,
        city: 'تهران',
        postalCode: '1234567890',
        addressLine: 'خیابان آزمایشی، پلاک ۱',
      },
      paymentMethod: PAYMENT_METHODS.COD,
      ...overrides,
    };
    return { user, product, input };
  };

  const awaitingPayment = async ({ total = 340_000 } = {}) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], { total }),
    );
    fx.remember(order.id);
    const payment = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: total,
      authority: `A-${crypto.randomUUID()}`,
    });
    return { order, payment };
  };

  const recipients = () => mocks.sendSms.mock.calls.map(([to]) => to as string);

  it('reaches every admin who has a phone, exactly once, and no one else', async () => {
    // Three staff accounts, one of them an email-era row with no number. The
    // recipient list must be exactly what the DAO answers — which is how the
    // phone-less admin is proven skipped without counting the rows some other
    // suite left in the dev database.
    const one = await admin();
    const two = await admin();
    await admin(null);
    const { user, input } = await checkout();

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    const expected = (await UserDao.listAdminsWithPhone()).map(
      (row) => row.phoneNumber,
    );
    await vi.waitFor(() =>
      expect(mocks.sendSms).toHaveBeenCalledTimes(expected.length),
    );
    expect(recipients().sort()).toEqual([...expected].sort());
    expect(recipients()).toContain(one.phoneNumber);
    expect(recipients()).toContain(two.phoneNumber);
    expect(recipients().filter((to) => to === one.phoneNumber)).toHaveLength(1);
  });

  it('says the order number, the total and «کارت به کارت» — and nothing else', async () => {
    await admin();
    const { user, input } = await checkout();

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    await vi.waitFor(() => expect(mocks.sendSms).toHaveBeenCalled());
    const [, message] = mocks.sendSms.mock.calls[0]!;
    expect(message).toEqual(newOrderAlert(order));
    expect(message.parameters).toEqual({
      // The order number the admin sees on the orders page, never the uuid,
      // and ungrouped — a separator would read as a price.
      ORDER: toPersianDigits(order.orderNo),
      AMOUNT: formatToman(order.total),
      METHOD: 'کارت به کارت',
    });
    // No customer data on an insecure channel: the recipient this order was
    // placed for appears nowhere in what is sent.
    expect(JSON.stringify(message)).not.toContain(input.address.recipientName);
    expect(JSON.stringify(message)).not.toContain(input.address.recipientPhone);
  });

  it('says «زرین‌پال» when a gateway payment settles', async () => {
    await admin();
    const { order, payment } = await awaitingPayment();

    expect(await settlePendingPayment(payment, stubClient())).toBe('paid');

    await vi.waitFor(() => expect(mocks.sendSms).toHaveBeenCalled());
    const [, message] = mocks.sendSms.mock.calls[0]!;
    expect(message.parameters).toMatchObject({
      ORDER: toPersianDigits(order.orderNo),
      METHOD: 'زرین‌پال',
    });
  });

  it('leaves the checkout untouched when the provider refuses the send', async () => {
    await admin();
    mocks.sendSms.mockRejectedValue(new Error('sms.ir refused the send'));
    const { user, input, product } = await checkout();

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    // The shopper's answer, and the database behind it, are what they would
    // have been with no alert at all.
    expect(order.status).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
    const [row] = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row.status).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
    const [stocked] = await testDb
      .select()
      .from(products)
      .where(eq(products.id, product.id));
    expect(stocked.stock).toBe(3);

    // …and the failure is reported, with the order number and nothing else.
    await vi.waitFor(() => expect(mocks.captureException).toHaveBeenCalled());
    expect(mocks.captureException.mock.calls[0]![1].extra).toEqual({
      orderNo: order.orderNo,
    });
  });

  it('leaves the settle untouched when the provider refuses the send', async () => {
    // The reconcile sweep counts this outcome. A wedged SMS provider must not
    // move its numbers.
    await admin();
    mocks.sendSms.mockRejectedValue(new Error('sms.ir refused the send'));
    const { order, payment } = await awaitingPayment();

    expect(await settlePendingPayment(payment, stubClient())).toBe('paid');

    const [row] = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row.status).toBe(ORDER_STATUSES.PAID);
    const [paid] = await testDb
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id));
    expect(paid.status).toBe(PAYMENT_STATUSES.PAID);
    await vi.waitFor(() => expect(mocks.captureException).toHaveBeenCalled());
  });

  it('leaves the checkout untouched when the provider hangs', async () => {
    // The 10 s timeout the SMS.ir driver puts on its own request is the bound
    // here; the caller adds none, because it never waits. A send still in
    // flight when the response goes out is the normal case, not an error.
    await admin();
    mocks.sendSms.mockReturnValue(new Promise(() => {}));
    const { user, input } = await checkout();

    const order = await createOrder(user.id, input);
    fx.remember(order.id);

    expect(order.status).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
    await vi.waitFor(() => expect(mocks.sendSms).toHaveBeenCalled());
    // Nothing was reported: a slow provider is not a failure.
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
