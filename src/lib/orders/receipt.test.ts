// The pure receipt rules both sides read — no database, no storage. Which
// orders take a receipt, which show the box, what the list's pill says, and
// the browser-side courtesy check on a picked file (the server re-sniffs).
import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import {
  acceptsReceipts,
  MAX_RECEIPT_BYTES,
  RECEIPT_CAP_MESSAGE,
  RECEIPT_FORMAT_HINT,
  RECEIPT_SIZE_ERROR,
  receiptSchema,
  receiptsLabel,
  showsReceipts,
  validateReceiptFile,
} from './receipt';

const cod = (status: OrderStatus) => ({
  paymentMethod: PAYMENT_METHODS.COD,
  status,
});

describe('acceptsReceipts', () => {
  // The box is open while the order waits for its receipt and while it is
  // being processed (a second transfer under a daily card limit), and never
  // on a gateway order or one that has left the shop's hands.
  const OPEN: readonly OrderStatus[] = [
    ORDER_STATUSES.AWAITING_RECEIPT,
    ORDER_STATUSES.PROCESSING,
  ];

  it.each(ORDER_STATUS_VALUES)('card to card, %s', (status) => {
    expect(acceptsReceipts(cod(status))).toBe(OPEN.includes(status));
  });

  it.each(ORDER_STATUS_VALUES)('never a Zarinpal order, %s', (status) => {
    expect(
      acceptsReceipts({ paymentMethod: PAYMENT_METHODS.ZARINPAL, status }),
    ).toBe(false);
  });
});

describe('showsReceipts', () => {
  it('shows the box on a card-to-card order that takes receipts, with none yet', () => {
    expect(showsReceipts(cod(ORDER_STATUSES.AWAITING_RECEIPT), 0)).toBe(true);
  });

  it.each([
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.CANCELLED,
  ])('keeps the uploaded receipts visible on a %s order', (status) => {
    expect(showsReceipts(cod(status), 1)).toBe(true);
  });

  it.each([ORDER_STATUSES.SHIPPED, ORDER_STATUSES.CANCELLED])(
    'shows nothing on a %s order that never had a receipt',
    (status) => {
      expect(showsReceipts(cod(status), 0)).toBe(false);
    },
  );

  it.each(PAYMENT_METHOD_VALUES.filter((m) => m !== PAYMENT_METHODS.COD))(
    'never shows on a %s order',
    (paymentMethod) => {
      expect(
        showsReceipts({ paymentMethod, status: ORDER_STATUSES.PROCESSING }, 0),
      ).toBe(false);
    },
  );
});

describe('receiptsLabel', () => {
  it.each([
    [ORDER_STATUSES.CANCELLED, 'رد شده'],
    [ORDER_STATUSES.SHIPPED, 'تأیید شد'],
    [ORDER_STATUSES.DELIVERED, 'تأیید شد'],
    [ORDER_STATUSES.PROCESSING, 'دریافت شد؛ در حال بررسی'],
  ] as const)('reads %s receipts as «%s»', (status, label) => {
    expect(receiptsLabel(status)).toBe(label);
  });
});

describe('validateReceiptFile', () => {
  const file = (size: number, type: string, name = 'رسید.jpg') =>
    new File([new Uint8Array(size)], name, { type });

  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'lets a %s through',
    (type) => {
      expect(validateReceiptFile(file(10, type))).toBeNull();
    },
  );

  it('takes a file of exactly the cap and refuses one byte more', () => {
    expect(
      validateReceiptFile(file(MAX_RECEIPT_BYTES, 'image/png')),
    ).toBeNull();
    expect(validateReceiptFile(file(MAX_RECEIPT_BYTES + 1, 'image/png'))).toBe(
      RECEIPT_SIZE_ERROR,
    );
  });

  it.each(['application/pdf', 'image/heic', 'image/gif', ''])(
    'refuses a %j file in Persian',
    (type) => {
      const refusal = validateReceiptFile(file(10, type, 'receipt.pdf'));
      expect(refusal).toMatch(/[؀-ۿ]/);
    },
  );
});

describe('the receipt copy', () => {
  it('names the formats and the five megabytes, in Persian digits', () => {
    expect(RECEIPT_FORMAT_HINT).toBe('JPG، PNG یا WEBP، تا ۵ مگابایت');
    expect(RECEIPT_SIZE_ERROR).toBe('حجم تصویر باید حداکثر ۵ مگابایت باشد.');
  });

  it('points the sixth receipt to support, its number in Persian', () => {
    expect(RECEIPT_CAP_MESSAGE).toBe(
      `حداکثر ${'۵'} رسید برای هر سفارش؛ برای رسید بیشتر با پشتیبانی تماس بگیر.`,
    );
  });

  it.each([RECEIPT_FORMAT_HINT, RECEIPT_SIZE_ERROR, RECEIPT_CAP_MESSAGE])(
    'carries no ASCII digit: %s',
    (copy) => {
      // The checkout E2E asserts `main` has none.
      expect(copy).not.toMatch(/\d/);
    },
  );
});

describe('receiptSchema', () => {
  it('is an id and an upload time — no key, no URL, no size', () => {
    const wire = receiptSchema.parse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2026-09-30T10:00:00.000Z',
      objectKey: 'receipts/123e4567-e89b-12d3-a456-426614174000.jpg',
      url: 'https://storage.example/receipts/x.jpg',
      size: 10,
    });
    expect(Object.keys(wire).sort()).toEqual(['createdAt', 'id']);
  });
});
