// Pure rules — no database. The DB side effects (CAS, restock, COD flip) are
// exercised in src/logic/orders/state-machine.integration.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
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
