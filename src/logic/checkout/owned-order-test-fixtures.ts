// A card-to-card order as `getOwnedOrder` hands it to the shopper's pages, for
// the page tests: every column the row carries, waiting for its receipt — and
// the same order once its first receipt has accepted it.
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import type { OwnedOrder } from './get-order';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PLACED_AT = new Date('2026-10-02T09:30:00.000Z');

export const waitingCardToCardOrder: OwnedOrder = {
  id: ORDER_ID,
  orderNo: 12,
  userId: 'user-1',
  status: ORDER_STATUSES.AWAITING_RECEIPT,
  paymentMethod: PAYMENT_METHODS.COD,
  subtotal: 125_000,
  shippingFee: 25_000,
  discount: 0,
  total: 150_000,
  discountCode: null,
  provinceId: 1,
  provinceName: 'تهران',
  recipientName: 'سارا محمدی',
  recipientPhone: '+989120000000',
  city: 'تهران',
  postalCode: '1234567890',
  addressLine: 'خیابان آزادی، کوچه بهار، پلاک ۱۲',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  cancellationReason: null,
  createdAt: PLACED_AT,
  updatedAt: PLACED_AT,
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orderId: ORDER_ID,
      productId: '44444444-4444-4444-8444-444444444444',
      title: 'تشویقی طبیعی مرغ و سبزیجات گربه',
      sku: 'SKU-1',
      unitPrice: 125_000,
      qty: 1,
      createdAt: PLACED_AT,
    },
  ],
  payments: [
    {
      method: PAYMENT_METHODS.COD,
      status: PAYMENT_STATUSES.PENDING,
      paidAt: null,
    },
  ],
  receipts: [],
};

export const acceptedCardToCardOrder: OwnedOrder = {
  ...waitingCardToCardOrder,
  status: ORDER_STATUSES.PROCESSING,
  receipts: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      createdAt: new Date('2026-10-02T09:31:00.000Z'),
    },
  ],
};
