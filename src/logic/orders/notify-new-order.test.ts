// The alert's pure parts — the message the admin reads and the decision to send
// it at all — plus the one property the orchestration owes its callers: it never
// rejects. Node 24 exits the process on an unhandled rejection, and this promise
// is deliberately un-awaited at both hook sites.
//
// The DAOs and the SMS seam are mocked at the module edge; the database-backed
// proof that the hooks fire lives in the two integration suites next door.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { SMS_TEMPLATES } from '@/lib/sms';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  listAdminsWithPhone: vi.fn(),
  sendSms: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/db/dao/OrderDao', () => ({ OrderDao: { getById: mocks.getById } }));
vi.mock('@/db/dao/UserDao', () => ({
  UserDao: { listAdminsWithPhone: mocks.listAdminsWithPhone },
}));
vi.mock('@/lib/sms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sms')>()),
  sendSms: mocks.sendSms,
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
}));

const {
  newOrderAlert,
  notifiesOnCreate,
  notifiesOnSettle,
  notifyAdminsOfNewOrder,
} = await import('./notify-new-order');

const ORDER = {
  id: 'order-uuid',
  orderNo: 1024,
  total: 2_450_000,
  paymentMethod: PAYMENT_METHODS.COD as PaymentMethod,
};

describe('newOrderAlert', () => {
  const parametersOf = (order: typeof ORDER) => newOrderAlert(order).parameters;

  it('names the order by its order number, in Persian digits', () => {
    expect(parametersOf(ORDER)).toMatchObject({ ORDER: '۱۰۲۴' });
  });

  it('leaves the order number ungrouped — a separator reads as a price', () => {
    // formatNumber would render ۱٬۰۲۴ here, which an admin reads as money.
    expect(parametersOf({ ...ORDER, orderNo: 1024 }).ORDER).not.toContain('٬');
  });

  it('formats the total through formatToman', () => {
    expect(parametersOf(ORDER)).toMatchObject({ AMOUNT: '۲٬۴۵۰٬۰۰۰ تومان' });
  });

  it('names the card-to-card method in Persian', () => {
    expect(parametersOf(ORDER)).toMatchObject({ METHOD: 'کارت به کارت' });
  });

  it('names the Zarinpal method in Persian', () => {
    expect(
      parametersOf({ ...ORDER, paymentMethod: PAYMENT_METHODS.ZARINPAL }),
    ).toMatchObject({ METHOD: 'زرین‌پال' });
  });

  it('carries the order template, never the OTP one', () => {
    expect(newOrderAlert(ORDER).template).toBe(SMS_TEMPLATES.NEW_ORDER);
  });

  it('carries these three parameters and nothing else — no customer data', () => {
    // The structural pin for «no customer data»: a recipient name, phone or
    // address added to the builder fails here, not in a shopper's SMS.
    expect(Object.keys(newOrderAlert(ORDER).parameters)).toEqual([
      'ORDER',
      'AMOUNT',
      'METHOD',
    ]);
  });

  it('formats a zero total rather than throwing on it', () => {
    // A fully discounted order is still an order the admin has to pack.
    expect(parametersOf({ ...ORDER, total: 0 }).AMOUNT).toBe('۰ تومان');
  });
});

describe('notifiesOnCreate', () => {
  it('notifies for a card-to-card order, which is born processing', () => {
    expect(notifiesOnCreate(ORDER_STATUSES.PROCESSING)).toBe(true);
  });

  it('says nothing for pending_payment — an unfinished checkout', () => {
    // The Zarinpal order that has only been created. Its alert, if the shopper
    // ever pays, comes from the settle instead.
    expect(notifiesOnCreate(ORDER_STATUSES.PENDING_PAYMENT)).toBe(false);
  });

  it.each(
    Object.values(ORDER_STATUSES).filter(
      (status) => status !== ORDER_STATUSES.PENDING_PAYMENT,
    ),
  )('treats %j as a real order', (status) => {
    // Exhaustive over the domain: a status added later is a real order unless
    // somebody says otherwise here, which is the safe default for an alert.
    expect(notifiesOnCreate(status)).toBe(true);
  });
});

describe('notifiesOnSettle', () => {
  it('notifies on paid — the one outcome that is a new sale', () => {
    expect(notifiesOnSettle('paid')).toBe(true);
  });

  it.each(['already_paid', 'failed', 'refund_flagged'] as const)(
    'says nothing on %j',
    (outcome) => {
      // already_paid: a replayed callback or a lost race — the admin was told
      // when the first one settled. failed: no money. refund_flagged: money in
      // hand but no sale to pack, and its own story.
      expect(notifiesOnSettle(outcome)).toBe(false);
    },
  );
});

describe('notifyAdminsOfNewOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue(ORDER);
    mocks.listAdminsWithPhone.mockResolvedValue([
      { id: 'a1', phoneNumber: '+989121111111' },
    ]);
    mocks.sendSms.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the alert to the admin', async () => {
    await notifyAdminsOfNewOrder(ORDER.id);

    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
    expect(mocks.sendSms).toHaveBeenCalledWith(
      '+989121111111',
      newOrderAlert(ORDER),
    );
  });

  it('sends nothing and reports nothing when there are no admins', async () => {
    // A fresh clone. The order still succeeded; silence is the right answer.
    mocks.listAdminsWithPhone.mockResolvedValue([]);

    await notifyAdminsOfNewOrder(ORDER.id);

    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('reaches every admin even when one of them fails', async () => {
    mocks.listAdminsWithPhone.mockResolvedValue([
      { id: 'a1', phoneNumber: '+989121111111' },
      { id: 'a2', phoneNumber: '+989122222222' },
    ]);
    mocks.sendSms.mockRejectedValueOnce(new Error('sms.ir refused the send'));

    await notifyAdminsOfNewOrder(ORDER.id);

    expect(mocks.sendSms).toHaveBeenCalledTimes(2);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a sender that rejects',
      () => mocks.sendSms.mockRejectedValue(new Error('nope')),
    ],
    [
      'a sender that throws synchronously',
      () =>
        mocks.sendSms.mockImplementation(() => {
          throw new Error('nope');
        }),
    ],
    ['an unreadable order', () => mocks.getById.mockResolvedValue(null)],
    [
      'a database that is down',
      () =>
        mocks.listAdminsWithPhone.mockRejectedValue(new Error('ECONNREFUSED')),
    ],
  ])('resolves rather than rejecting on %s', async (_label, arrange) => {
    // The hook sites `void` this promise. A rejection here takes the container
    // down, long after the checkout it belongs to returned 201.
    arrange();

    await expect(notifyAdminsOfNewOrder(ORDER.id)).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it('resolves even when the reporting itself throws', async () => {
    // The last line of defence. `report` runs in the catch, so anything it
    // throws — a console that has lost its pipe, a Sentry client mid-init —
    // leaves the un-awaited promise rejected, and Node 24 exits the process on
    // an unhandled rejection. Long after the checkout it belongs to returned.
    mocks.sendSms.mockRejectedValue(new Error('sms.ir refused the send'));
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('EPIPE');
    });

    await expect(notifyAdminsOfNewOrder(ORDER.id)).resolves.toBeUndefined();
  });

  it('reports the order number to Sentry and nothing else', async () => {
    // The privacy contract in src/lib/sentry.ts: no admin phone number, nothing
    // of the customer's, in an error report.
    mocks.sendSms.mockRejectedValue(new Error('sms.ir refused the send'));

    await notifyAdminsOfNewOrder(ORDER.id);

    const [, context] = mocks.captureException.mock.calls[0]!;
    expect(context.extra).toEqual({ orderNo: ORDER.orderNo });
  });

  it('keeps the admin phone number out of the log line', async () => {
    mocks.sendSms.mockRejectedValue(new Error('sms.ir refused the send'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyAdminsOfNewOrder(ORDER.id);

    expect(String(error.mock.calls[0])).not.toContain('+989121111111');
  });
});
