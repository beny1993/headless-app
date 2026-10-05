// Pure rules — no database. The DB side effects (CAS, restock, COD flip) are
// exercised in src/logic/orders/state-machine.integration.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  byProductId,
  adminNextStatuses,
  adminTransitionBodySchema,
  adminTransitionTargetSchema,
  CANCELLATION_REASON_MAX,
  CANCELLATION_REASON_REQUIRED_MESSAGE,
  canTransition,
  GATEWAY_OWNED_STATUSES,
  initialStatusFor,
  OPEN_ORDER_STATUSES,
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';

// The ten legal edges from the design notes' diagrams, spelled out here so this
// test is an independent statement of the contract, not a re-read of the map it
// checks. If the map and this list disagree, one of them is wrong. The two out
// of `awaiting_receipt` are the card-to-card receipt story's: the first receipt
// (or the admin's hand) accepts the order, or the admin cancels it.
const LEGAL_EDGES: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID],
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.FAILED],
  [ORDER_STATUSES.AWAITING_RECEIPT, ORDER_STATUSES.PROCESSING],
  [ORDER_STATUSES.AWAITING_RECEIPT, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PAID, ORDER_STATUSES.PROCESSING],
  [ORDER_STATUSES.PAID, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.SHIPPED],
  [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED],
];

const edgeKey = (from: OrderStatus, to: OrderStatus) => `${from}->${to}`;
const legalKeys = new Set(LEGAL_EDGES.map(([f, t]) => edgeKey(f, t)));

describe('order state machine transition rules', () => {
  it('has exactly the ten legal edges the design defines', () => {
    const mapped = ORDER_STATUS_VALUES.flatMap((from) =>
      ALLOWED_TRANSITIONS[from].map((to) => edgeKey(from, to)),
    );
    expect(mapped.sort()).toEqual([...legalKeys].sort());
  });

  // Every ordered pair of the 8 statuses (8 * 7 = 56 distinct-pair permutations)
  // plus the 8 self-pairs: canTransition must pass iff the pair is one of the
  // ten legal edges, and never for a self-transition. This is the exhaustive
  // legal/illegal matrix the testing standard asks money/state logic to carry.
  const pairs = ORDER_STATUS_VALUES.flatMap((from) =>
    ORDER_STATUS_VALUES.map((to) => [from, to] as const),
  );

  it('covers the full 8x8 matrix (64 ordered pairs, 56 non-self)', () => {
    expect(pairs).toHaveLength(64);
    expect(pairs.filter(([f, t]) => f !== t)).toHaveLength(56);
  });

  it('lets a waiting card-to-card order reach neither paid nor failed', () => {
    // `paid` and `failed` stay the gateway's: the waiting state's only exits are
    // acceptance and cancellation, so no receipt can ever book money.
    for (const to of [ORDER_STATUSES.PAID, ORDER_STATUSES.FAILED]) {
      expect(canTransition(ORDER_STATUSES.AWAITING_RECEIPT, to)).toBe(false);
    }
  });

  it('lets nothing move an order back into awaiting_receipt', () => {
    // A pre-upload state: once accepted or cancelled, an order never waits for
    // its receipt again.
    for (const from of ORDER_STATUS_VALUES) {
      expect(canTransition(from, ORDER_STATUSES.AWAITING_RECEIPT)).toBe(false);
    }
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
    // Acceptance by hand (a receipt sent by DM) or cancellation — never paid.
    [ORDER_STATUSES.AWAITING_RECEIPT]: [
      ORDER_STATUSES.PROCESSING,
      ORDER_STATUSES.CANCELLED,
    ],
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
  it('starts a card-to-card order waiting for its receipt, not in processing', () => {
    // The shopper's first receipt accepts it; until then nothing is fulfilled.
    expect(initialStatusFor(PAYMENT_METHODS.COD)).toBe(
      ORDER_STATUSES.AWAITING_RECEIPT,
    );
  });

  it('starts a Zarinpal order in pending_payment', () => {
    expect(initialStatusFor(PAYMENT_METHODS.ZARINPAL)).toBe(
      ORDER_STATUSES.PENDING_PAYMENT,
    );
  });
});

describe('OPEN_ORDER_STATUSES (the open-order cap)', () => {
  it.each(PAYMENT_METHOD_VALUES)(
    'counts a freshly created %s order against the cap',
    (method) => {
      // Both birth states hold reserved stock with no automatic release —
      // Zarinpal's until the reconcile sweep, card-to-card's until an upload or
      // an admin — so every new order must count, whichever way it is paid.
      expect(OPEN_ORDER_STATUSES).toContain(initialStatusFor(method));
    },
  );

  it.each([
    ORDER_STATUSES.PAID,
    ORDER_STATUSES.PROCESSING,
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.FAILED,
  ])('does not count a %s order', (status) => {
    // Accepted, fulfilled or closed: the stock is sold or already back.
    expect(OPEN_ORDER_STATUSES).not.toContain(status);
  });
});

describe('adminTransitionBodySchema', () => {
  // Constructed, never typed: the project's control-character rule.
  const NUL = String.fromCharCode(0);
  const RLM = String.fromCharCode(0x200f);
  const RLO = String.fromCharCode(0x202e);
  const ZWNJ = String.fromCharCode(0x200c);

  it('takes a target with no reason — acceptance and shipping carry none', () => {
    expect(
      adminTransitionBodySchema.parse({ to: ORDER_STATUSES.PROCESSING }),
    ).toEqual({ to: ORDER_STATUSES.PROCESSING });
  });

  it('keeps a trimmed Persian reason', () => {
    expect(
      adminTransitionBodySchema.parse({
        to: ORDER_STATUSES.CANCELLED,
        reason: '  رسید با مبلغ سفارش نمی‌خواند  ',
      }),
    ).toEqual({
      to: ORDER_STATUSES.CANCELLED,
      reason: 'رسید با مبلغ سفارش نمی‌خواند',
    });
  });

  it.each(['', '   '])(
    'turns a blank reason (%j) into no reason at all',
    (reason) => {
      // The server's `reason_required` is what then refuses a cancel: a blank
      // field is «no reason», never a stored empty string the shopper reads.
      expect(
        adminTransitionBodySchema.parse({
          to: ORDER_STATUSES.CANCELLED,
          reason,
        }).reason,
      ).toBeUndefined();
    },
  );

  it('accepts a reason exactly at the cap and refuses one past it', () => {
    const at = 'ر'.repeat(CANCELLATION_REASON_MAX);
    expect(
      adminTransitionBodySchema.safeParse({
        to: ORDER_STATUSES.CANCELLED,
        reason: at,
      }).success,
    ).toBe(true);
    expect(
      adminTransitionBodySchema.safeParse({
        to: ORDER_STATUSES.CANCELLED,
        reason: `${at}ر`,
      }).success,
    ).toBe(false);
  });

  it('refuses a reason of nothing a person can see — zero-width non-joiners only', () => {
    // ZWNJ is allowed inside Persian words, so the shared text rule lets it
    // through; on its own it is an empty reason the shopper would read.
    const result = adminTransitionBodySchema.safeParse({
      to: ORDER_STATUSES.CANCELLED,
      reason: ZWNJ.repeat(2),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      CANCELLATION_REASON_REQUIRED_MESSAGE,
    );
  });

  it.each([
    ['the Hangul filler', 0x3164],
    ['the Hangul choseong filler', 0x115f],
    ['the Hangul jungseong filler', 0x1160],
    ['the halfwidth Hangul filler', 0xffa0],
    ['the blank Braille pattern', 0x2800],
    // Pasted with rich text: draws no ink.
    ['the object replacement character', 0xfffc],
    // A box on macOS, but blank where a font has no glyph for them.
    ['the musical null notehead', 0x1d159],
    ['the Egyptian hieroglyph full blank', 0x13441],
    ['the Egyptian hieroglyph half blank', 0x13442],
  ])(
    'refuses a reason of %s alone — a letter or a symbol by category, blank on screen',
    (_, codePoint) => {
      const blank = String.fromCodePoint(codePoint);
      for (const reason of [blank.repeat(3), `${ZWNJ}${blank}`]) {
        const result = adminTransitionBodySchema.safeParse({
          to: ORDER_STATUSES.CANCELLED,
          reason,
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toBe(
          CANCELLATION_REASON_REQUIRED_MESSAGE,
        );
      }
    },
  );

  it.each([
    ['a Persian word', 'دلیل'],
    ['a ZWNJ inside a word', `رسید${ZWNJ}ها`],
    ['a lone full stop', '.'],
  ])('still takes %s', (_, reason) => {
    expect(
      adminTransitionBodySchema.parse({ to: ORDER_STATUSES.CANCELLED, reason })
        .reason,
    ).toBe(reason);
  });

  it('keeps the ZWNJ inside a Persian reason', () => {
    const reason = `رسید${ZWNJ}ها نرسید`;
    expect(
      adminTransitionBodySchema.parse({ to: ORDER_STATUSES.CANCELLED, reason })
        .reason,
    ).toBe(reason);
  });

  it.each([
    ['a NUL', `دلیل${NUL}`],
    ['a right-to-left mark', `دلیل${RLM}۱۲۳`],
    ['a right-to-left override', `${RLO}دلیل`],
  ])('refuses a reason carrying %s', (_, reason) => {
    // Admin text a shopper reads: a bidi control would reorder their screen.
    expect(
      adminTransitionBodySchema.safeParse({
        to: ORDER_STATUSES.CANCELLED,
        reason,
      }).success,
    ).toBe(false);
  });

  it('refuses a target that is not a status', () => {
    expect(
      adminTransitionBodySchema.safeParse({ to: 'nonsense', reason: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('byProductId', () => {
  it('orders by code unit, not by locale or number', () => {
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
