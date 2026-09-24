import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnedOrder } from './load-owned-order';
import { toSummaryLines } from './order-summary';

const { requireSession, getOwnedOrder } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getOwnedOrder: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/session', () => ({ requireSession }));
vi.mock('@/logic/checkout/get-order', () => ({ getOwnedOrder }));
// Never reached by these tests; stubbed so the module loads without a database.
vi.mock('@/db/dao/SiteContentDao', () => ({ SiteContentDao: {} }));

const ORDER_ID = '0b8f5a52-3f0e-4c8e-9a51-2d2f1c7e4b10';
const returnTo = (id: string) => `/orders/${id}`;

beforeEach(() => {
  vi.resetAllMocks();
  requireSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('loadOwnedOrder', () => {
  it('returns the order the signed-in customer owns', async () => {
    const order = { id: ORDER_ID };
    getOwnedOrder.mockResolvedValue(order);

    await expect(loadOwnedOrder(ORDER_ID, returnTo)).resolves.toBe(order);
    // The owner is the session's, and a re-login returns to this order.
    expect(getOwnedOrder).toHaveBeenCalledWith(ORDER_ID, 'user-1');
    expect(requireSession).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
  });

  it('404s a non-uuid segment before asking for a session', async () => {
    await expect(loadOwnedOrder('42', returnTo)).rejects.toThrow('NOT_FOUND');
    expect(requireSession).not.toHaveBeenCalled();
  });

  it('404s an order that is missing or someone else’s', async () => {
    getOwnedOrder.mockResolvedValue(null);

    await expect(loadOwnedOrder(ORDER_ID, returnTo)).rejects.toThrow(
      'NOT_FOUND',
    );
  });
});

describe('toSummaryLines', () => {
  it('prices each snapshotted item at unit price × quantity', () => {
    expect(
      toSummaryLines([
        { id: 'a', title: 'غذای خشک', qty: 3, unitPrice: 185_000 },
        { id: 'b', title: 'اسباب‌بازی', qty: 1, unitPrice: 0 },
      ]),
    ).toEqual([
      { id: 'a', title: 'غذای خشک', qty: 3, lineTotal: 555_000 },
      { id: 'b', title: 'اسباب‌بازی', qty: 1, lineTotal: 0 },
    ]);
  });

  it('is empty for an order with no items', () => {
    expect(toSummaryLines([])).toEqual([]);
  });
});
