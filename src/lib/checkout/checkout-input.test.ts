// The checkout body contract is a trust boundary — a mass-assignment gate, an
// overflow gate, and the 500-hole gate (bad uuid / null byte / out-of-range
// province). These are pure schema behaviours, so they run without a database.
// Control characters are constructed with `String.fromCharCode`, never typed —
// the testing standard in the project guide.
import { describe, expect, it } from 'vitest';
import {
  MAX_CART_LINES,
  MAX_LINE_QTY,
  checkoutInputSchema,
} from '@/lib/checkout/checkout-input';

const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);
const RLM = String.fromCharCode(0x200f);
const LF = String.fromCharCode(10);
const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

const validBody = () => ({
  items: [{ productId: uuidA, qty: 2 }],
  address: {
    recipientName: 'علی رضایی',
    recipientPhone: '09121234567',
    provinceId: 1,
    city: 'تهران',
    postalCode: '1234567890',
    addressLine: 'خیابان آزادی، پلاک ۱۰',
  },
  paymentMethod: 'cod' as const,
});

describe('checkoutInputSchema — bidi characters', () => {
  // Not a hypothetical: `create-order.ts` snapshots recipientName onto
  // `orders.recipient_name`, and the admin order list renders that snapshot. A
  // signed-in shopper needs no admin rights to post one.
  it.each([
    ['a right-to-left override', RLO],
    ['a right-to-left mark', RLM],
  ])('rejects %s in the recipient name', (_label, char) => {
    const body = validBody();
    body.address.recipientName = `علی${char}۱۲۳`;
    expect(checkoutInputSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a bidi override in the address line', () => {
    const body = validBody();
    body.address.addressLine = `خیابان آزادی${RLO}`;
    expect(checkoutInputSchema.safeParse(body).success).toBe(false);
  });

  it('still accepts a multi-line address line — it is a textarea', () => {
    const body = validBody();
    body.address.addressLine = `خیابان آزادی${LF}پلاک ۱۰`;
    expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  });
});

describe('checkoutInputSchema', () => {
  it('accepts a well-formed cash-on-delivery order', () => {
    const parsed = checkoutInputSchema.parse(validBody());
    expect(parsed.items).toEqual([{ productId: uuidA, qty: 2 }]);
    expect(parsed.paymentMethod).toBe('cod');
    expect(parsed.address.provinceId).toBe(1);
  });

  it('accepts the zarinpal method', () => {
    const parsed = checkoutInputSchema.parse({
      ...validBody(),
      paymentMethod: 'zarinpal',
    });
    expect(parsed.paymentMethod).toBe('zarinpal');
  });

  describe('mass-assignment prevention', () => {
    it('strips a client-supplied status / userId / total / unitPrice / paidAt', () => {
      const parsed = checkoutInputSchema.parse({
        ...validBody(),
        status: 'delivered',
        userId: 'someone-else',
        total: 1,
        paidAt: new Date().toISOString(),
        items: [{ productId: uuidA, qty: 1, unitPrice: 1, price: 1 }],
      }) as Record<string, unknown>;

      expect(parsed).not.toHaveProperty('status');
      expect(parsed).not.toHaveProperty('userId');
      expect(parsed).not.toHaveProperty('total');
      expect(parsed).not.toHaveProperty('paidAt');
      expect(parsed.items).toEqual([{ productId: uuidA, qty: 1 }]);
      // The line keeps only productId + qty — no smuggled unitPrice/price.
      const [line] = parsed.items as Record<string, unknown>[];
      expect(Object.keys(line).sort()).toEqual(['productId', 'qty']);
    });
  });

  describe('items', () => {
    it('requires at least one line', () => {
      expect(
        checkoutInputSchema.safeParse({ ...validBody(), items: [] }).success,
      ).toBe(false);
    });

    it('rejects more than the cart-line cap', () => {
      const items = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({
        // distinct uuids so it is the count, not a duplicate, that fails
        productId: `${(i + 10).toString().padStart(8, '0')}-1111-4111-8111-111111111111`,
        qty: 1,
      }));
      expect(
        checkoutInputSchema.safeParse({ ...validBody(), items }).success,
      ).toBe(false);
    });

    it('rejects a non-uuid productId (a bad id would be a 22P02 → 500)', () => {
      const result = checkoutInputSchema.safeParse({
        ...validBody(),
        items: [{ productId: 'not-a-uuid', qty: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a qty of zero or below', () => {
      for (const qty of [0, -1]) {
        expect(
          checkoutInputSchema.safeParse({
            ...validBody(),
            items: [{ productId: uuidA, qty }],
          }).success,
        ).toBe(false);
      }
    });

    it('rejects a non-integer qty', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          items: [{ productId: uuidA, qty: 1.5 }],
        }).success,
      ).toBe(false);
    });

    it('rejects a qty over the per-line cap (overflow ceiling)', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          items: [{ productId: uuidA, qty: MAX_LINE_QTY + 1 }],
        }).success,
      ).toBe(false);
    });

    it('rejects duplicate productId lines, naming the offending line', () => {
      const result = checkoutInputSchema.safeParse({
        ...validBody(),
        items: [
          { productId: uuidA, qty: 1 },
          { productId: uuidB, qty: 1 },
          { productId: uuidA, qty: 3 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // The path points at the second occurrence (index 2), so the 400 names
        // the line the client can fix.
        expect(
          result.error.issues.some((i) => i.path.join('.') === 'items.2'),
        ).toBe(true);
      }
    });
  });

  describe('address', () => {
    it('requires provinceId (orders.province_id is nullable at the DB, not here)', () => {
      const { provinceId: _omit, ...address } = validBody().address;
      expect(
        checkoutInputSchema.safeParse({ ...validBody(), address }).success,
      ).toBe(false);
    });

    it('rejects an out-of-range provinceId (the int4 cap, not a 500)', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          address: { ...validBody().address, provinceId: 2_147_483_648 },
        }).success,
      ).toBe(false);
    });

    it('does not coerce a non-number provinceId — a JSON body must carry a real number', () => {
      // provinceIdParamSchema is z.coerce (built for the ?province= query string).
      // In this JSON body a string "5" or a boolean is a malformed client worth a
      // 400, not something to silently coerce to a valid id.
      for (const bad of ['5', true, null] as const) {
        expect(
          checkoutInputSchema.safeParse({
            ...validBody(),
            address: { ...validBody().address, provinceId: bad },
          }).success,
        ).toBe(false);
      }
      // A genuine number still passes — the imported int4 cap stays authoritative.
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          address: { ...validBody().address, provinceId: 7 },
        }).success,
      ).toBe(true);
    });

    it('rejects a null byte in any text field (would 500 in the pg driver)', () => {
      for (const field of [
        'recipientName',
        'recipientPhone',
        'city',
        'postalCode',
        'addressLine',
      ] as const) {
        const address = { ...validBody().address, [field]: `x${NUL}y` };
        expect(
          checkoutInputSchema.safeParse({ ...validBody(), address }).success,
        ).toBe(false);
      }
    });

    it('rejects an empty required text field', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          address: { ...validBody().address, recipientName: '   ' },
        }).success,
      ).toBe(false);
    });
  });

  describe('paymentMethod', () => {
    it('rejects an unknown method', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          paymentMethod: 'bitcoin',
        }).success,
      ).toBe(false);
    });
  });

  describe('deliveryMethod', () => {
    it('defaults to post when the body names none', () => {
      expect(checkoutInputSchema.parse(validBody()).deliveryMethod).toBe(
        'post',
      );
    });

    it('accepts courier and post', () => {
      for (const deliveryMethod of ['courier', 'post'] as const) {
        expect(
          checkoutInputSchema.parse({ ...validBody(), deliveryMethod })
            .deliveryMethod,
        ).toBe(deliveryMethod);
      }
    });

    it('rejects an unknown method, and a null', () => {
      for (const deliveryMethod of ['express', '', null, 1]) {
        expect(
          checkoutInputSchema.safeParse({ ...validBody(), deliveryMethod })
            .success,
        ).toBe(false);
      }
    });
  });

  describe('discountCode', () => {
    it('is optional', () => {
      expect(checkoutInputSchema.safeParse(validBody()).success).toBe(true);
    });

    it('accepts a bounded code', () => {
      const parsed = checkoutInputSchema.parse({
        ...validBody(),
        discountCode: 'WELCOME10',
      });
      expect(parsed.discountCode).toBe('WELCOME10');
    });

    it('rejects a null byte in the code', () => {
      expect(
        checkoutInputSchema.safeParse({
          ...validBody(),
          discountCode: `AB${NUL}CD`,
        }).success,
      ).toBe(false);
    });
  });
});
