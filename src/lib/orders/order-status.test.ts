// Pure rules — no database. The DB side effects (CAS, restock, COD flip) are
// exercised in src/logic/orders/state-machine.integration.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  byProductId,
  adminNextStatuses,
  adminTransitionTargetSchema,
  canTransition,
  GATEWAY_OWNED_STATUSES,
  initialStatusFor,
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';

// The eight legal edges from the design note's diagram, spelled out here so this
// test is an independent statement of the contract, not a re-read of the map it
// checks. If the map and this list disagree, one of them is wrong.
const LEGAL_EDGES: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID],
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.FAILED],
  [ORDER_STATUSES.PAID, ORDER_STATUSES.PROCESSING],
  [ORDER_STATUSES.PAID, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.SHIPPED],
  [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED],
];

const edgeKey = (from: OrderStatus, to: OrderStatus) => `${from}->${to}`;
const legalKeys = new Set(LEGAL_EDGES.map(([f, t]) => edgeKey(f, t)));

describe('order state machine transition rules', () => {
  it('has exactly the eight legal edges the design defines', () => {
    const mapped = ORDER_STATUS_VALUES.flatMap((from) =>
      ALLOWED_TRANSITIONS[from].map((to) => edgeKey(from, to)),
    );
    expect(mapped.sort()).toEqual([...legalKeys].sort());
  });

  // Every ordered pair of the 7 statuses (7 * 6 = 42 distinct-pair permutations)
  // plus the 7 self-pairs: canTransition must pass iff the pair is one of the
  // eight legal edges, and never for a self-transition. This is the exhaustive
  // legal/illegal matrix the testing standard asks money/state logic to carry.
  const pairs = ORDER_STATUS_VALUES.flatMap((from) =>
    ORDER_STATUS_VALUES.map((to) => [from, to] as const),
  );

  it('covers the full 7x7 matrix (49 ordered pairs, 42 non-self)', () => {
    expect(pairs).toHaveLength(49);
    expect(pairs.filter(([f, t]) => f !== t)).toHaveLength(42);
  });

  it.each(pairs)(
    'canTransition(%s -> %s) matches the legal set',
    (from, to) => {
      expect(canTransition(from, to)).toBe(legalKeys.has(edgeKey(from, to)));
    },
  );

  it('rejects every self-transition', () => {
    for (const status of ORDER_STATUS_VALUES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('gives every terminal status no outgoing edges', () => {
    for (const terminal of [
      ORDER_STATUSES.DELIVERED,
      ORDER_STATUSES.CANCELLED,
      ORDER_STATUSES.FAILED,
    ]) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('adminNextStatuses (admin-triggerable subset)', () => {
  // The admin panel offers these buttons. Spelled out independently of the
  // implementation — it must reproduce exactly the design's ADMIN_TRANSITIONS,
  // which is the full machine minus the gateway-owned targets. If this list and
  // the derived map disagree, one is wrong.
  const ADMIN_NEXT: Record<OrderStatus, OrderStatus[]> = {
    [ORDER_STATUSES.PENDING_PAYMENT]: [ORDER_STATUSES.CANCELLED],
    [ORDER_STATUSES.PAID]: [
      ORDER_STATUSES.PROCESSING,
      ORDER_STATUSES.CANCELLED,
    ],
    [ORDER_STATUSES.PROCESSING]: [
      ORDER_STATUSES.SHIPPED,
      ORDER_STATUSES.CANCELLED,
    ],
    [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED],
    [ORDER_STATUSES.DELIVERED]: [],
    [ORDER_STATUSES.CANCELLED]: [],
    [ORDER_STATUSES.FAILED]: [],
  };

  it('gateway-owned statuses are exactly paid and failed', () => {
    expect([...GATEWAY_OWNED_STATUSES].sort()).toEqual(
      [ORDER_STATUSES.PAID, ORDER_STATUSES.FAILED].sort(),
    );
  });

  it.each(ORDER_STATUS_VALUES)(
    'offers exactly the design-defined admin targets from %s',
    (from) => {
      expect([...adminNextStatuses(from)]).toEqual(ADMIN_NEXT[from]);
    },
  );

  it('never offers a gateway-owned target (no admin route to paid/failed)', () => {
    for (const from of ORDER_STATUS_VALUES) {
      for (const to of adminNextStatuses(from)) {
        expect(GATEWAY_OWNED_STATUSES).not.toContain(to);
      }
    }
  });

  it('every admin target is a real legal edge of the machine (a subset, never a superset)', () => {
    for (const from of ORDER_STATUS_VALUES) {
      for (const to of adminNextStatuses(from)) {
        expect(canTransition(from, to)).toBe(true);
        expect(ALLOWED_TRANSITIONS[from]).toContain(to);
      }
    }
  });

  it('validates a target status, rejecting non-statuses', () => {
    expect(adminTransitionTargetSchema.safeParse('shipped').success).toBe(true);
    expect(adminTransitionTargetSchema.safeParse('paid').success).toBe(true);
    expect(adminTransitionTargetSchema.safeParse('nonsense').success).toBe(
      false,
    );
    expect(adminTransitionTargetSchema.safeParse(3).success).toBe(false);
  });
});

describe('initialStatusFor', () => {
  it('starts a COD order in processing — no gateway step', () => {
    expect(initialStatusFor(PAYMENT_METHODS.COD)).toBe(
      ORDER_STATUSES.PROCESSING,
    );
  });

  it('starts a Zarinpal order in pending_payment', () => {
    expect(initialStatusFor(PAYMENT_METHODS.ZARINPAL)).toBe(
      ORDER_STATUSES.PENDING_PAYMENT,
    );
  });
});

describe('byProductId', () => {
  it('orders by code point, not by locale or number', () => {
    const ids = ['a', 'Z', '9', '10', 'b'].map((productId) => ({ productId }));
    expect(ids.sort(byProductId).map((line) => line.productId)).toEqual([
      '10',
      '9',
      'Z',
      'a',
      'b',
    ]);
  });

  it('treats equal ids as equal', () => {
    expect(byProductId({ productId: 'x' }, { productId: 'x' })).toBe(0);
  });
});
