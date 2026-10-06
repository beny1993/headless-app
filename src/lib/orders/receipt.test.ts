// The pure receipt rules both sides read — no database, no storage. Which
// orders take a receipt, which show the box, what the list's pill says, and
// the browser-side check on a picked file, by its bytes as the server's is.
import { describe, expect, it } from 'vitest';
import { IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import {
  acceptsReceipts,
  MAX_RECEIPT_BYTES,
  RECEIPT_CAP_MESSAGE,
  RECEIPT_FORMAT_HINT,
  RECEIPT_READ_ERROR,
  RECEIPT_SIZE_ERROR,
  receiptSchema,
  receiptsLabel,
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
  // Leading bytes, constructed: what the server's sniff reads.
  const JPEG = [0xff, 0xd8, 0xff, 0xe0];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  // A RIFF container tagged WEBP at offset 8; bytes 4–7 are its size.
  const WEBP = [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBP')];

  /** `signature` followed by zeros, `size` bytes in all. */
  const file = (
    signature: number[],
    size: number,
    { name = 'رسید.jpg', type = 'image/jpeg' } = {},
  ) =>
    new File(
      [new Uint8Array(signature), new Uint8Array(size - signature.length)],
      name,
      { type },
    );

  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
  ])('lets a %s through', async (_, signature, type) => {
    expect(await validateReceiptFile(file(signature, 64, { type }))).toBeNull();
  });

  it('takes a file of exactly the cap and refuses one byte more', async () => {
    expect(await validateReceiptFile(file(JPEG, MAX_RECEIPT_BYTES))).toBeNull();
    expect(await validateReceiptFile(file(JPEG, MAX_RECEIPT_BYTES + 1))).toBe(
      RECEIPT_SIZE_ERROR,
    );
  });

  it('refuses a PDF renamed .jpg and declared a JPEG — the bytes decide', async () => {
    const renamed = file(ascii('%PDF-1.4'), 64, {
      name: 'receipt.jpg',
      type: 'image/jpeg',
    });
    expect(await validateReceiptFile(renamed)).toBe(IMAGE_TYPE_ERROR);
  });

  it.each(['', 'application/octet-stream'])(
    'takes a real screenshot whatever type the browser declares (%j)',
    async (type) => {
      expect(await validateReceiptFile(file(PNG, 64, { type }))).toBeNull();
    },
  );

  it.each([
    ['a GIF', ascii('GIF89a')],
    ['a HEIC photo', [0, 0, 0, 0x18, ...ascii('ftypheic')]],
    [
      'a RIFF that is not a WebP',
      [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVE')],
    ],
  ])('refuses %s', async (_, signature) => {
    expect(await validateReceiptFile(file(signature, 64))).toBe(
      IMAGE_TYPE_ERROR,
    );
  });

  it.each([
    ['an empty file', []],
    ['a WebP cut off before its tag', [...ascii('RIFF'), 0x24, 0, 0, 0]],
  ])('refuses %s, too short to carry a signature', async (_, bytes) => {
    expect(await validateReceiptFile(file(bytes, bytes.length))).toBe(
      IMAGE_TYPE_ERROR,
    );
  });
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

  it.each([
    RECEIPT_FORMAT_HINT,
    RECEIPT_SIZE_ERROR,
    RECEIPT_READ_ERROR,
    RECEIPT_CAP_MESSAGE,
  ])('carries no ASCII digit: %s', (copy) => {
    // The checkout E2E asserts `main` has none.
    expect(copy).not.toMatch(/\d/);
  });
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
