// Shared fixtures for the orders/payments integration suites. Import-safe on a
// machine with no database: it reaches only `testDb` (the null stand-in there)
// and the schema modules (which never import `@/db`), so the DB-less run still
// collects and skips cleanly. The DAOs and the state machine, which do import
// `@/db`, are pulled in by each suite through `importWithDb`, never here.
//
// The teardown order is the point of centralizing this: FKs are `restrict`
// (product←order_item, category←product, user←order), so rows must be removed
// orders-first — deleting an order cascades its items and payments, which frees
// the products, which frees the categories.
import { inArray } from 'drizzle-orm';
import { users, type User } from '@/db/schema/auth';
import {
  categories,
  products,
  PET_TYPES,
  type Category,
  type NewProduct,
  type Product,
} from '@/db/schema/catalog';
import { orders, type NewOrder } from '@/db/schema/orders';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { testDb } from '@/db/test-db';

const token = () => crypto.randomUUID().slice(0, 12);

/** One line of the order builder's output. */
type ItemSeed = { product: Product; qty?: number; unitPrice?: number };

/** A registry of everything a suite created, with a teardown that respects FKs. */
export class OrderFixtures {
  readonly userIds: string[] = [];
  readonly categoryIds: string[] = [];
  readonly productIds: string[] = [];
  readonly orderIds: string[] = [];

  async user(): Promise<User> {
    const t = token();
    const [row] = await testDb
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: 'مشتری آزمایشی',
        email: `test-${t}@example.com`,
      })
      .returning();
    this.userIds.push(row.id);
    return row;
  }

  async category(): Promise<Category> {
    const [row] = await testDb
      .insert(categories)
      .values({ title: 'دسته آزمایشی', slug: `test-${token()}` })
      .returning();
    this.categoryIds.push(row.id);
    return row;
  }

  async product(
    category: Category,
    overrides: Partial<NewProduct> = {},
  ): Promise<Product> {
    const t = token();
    const [row] = await testDb
      .insert(products)
      .values({
        title: 'محصول آزمایشی',
        slug: `test-${t}`,
        sku: `TEST-${t.toUpperCase()}`,
        price: 100_000,
        stock: 5,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
        ...overrides,
      })
      .returning();
    this.productIds.push(row.id);
    return row;
  }

  /**
   * A valid `OrderInput` (order fields + line items) with sensible defaults —
   * the subtotal/total are computed from the seeded lines so the money CHECKs
   * pass. Callers pass it to `OrderDao.create` themselves (via their
   * `importWithDb` handle) and then `remember` the returned id for teardown.
   */
  buildOrder(user: User, items: ItemSeed[], overrides: Partial<NewOrder> = {}) {
    const lines = items.map(({ product, qty = 1, unitPrice }) => ({
      productId: product.id,
      title: product.title,
      sku: product.sku,
      unitPrice: unitPrice ?? product.price,
      qty,
    }));
    const subtotal = lines.reduce(
      (sum, line) => sum + line.unitPrice * line.qty,
      0,
    );
    const shippingFee = 50_000;
    return {
      userId: user.id,
      status: ORDER_STATUSES.PENDING_PAYMENT,
      paymentMethod: PAYMENT_METHODS.ZARINPAL,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      provinceName: 'تهران',
      recipientName: 'گیرنده آزمایشی',
      recipientPhone: '+989120000000',
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان آزمایشی، پلاک ۱',
      items: lines,
      ...overrides,
    };
  }

  /** Record an order id created outside `buildOrder`, so teardown removes it. */
  remember(orderId: string): void {
    this.orderIds.push(orderId);
  }

  /** Remove everything this registry created, orders-first for the FK order. */
  async cleanup(): Promise<void> {
    if (this.orderIds.length > 0) {
      // Cascades order_items and payments.
      await testDb.delete(orders).where(inArray(orders.id, this.orderIds));
      this.orderIds.length = 0;
    }
    if (this.productIds.length > 0) {
      await testDb
        .delete(products)
        .where(inArray(products.id, this.productIds));
      this.productIds.length = 0;
    }
    if (this.categoryIds.length > 0) {
      await testDb
        .delete(categories)
        .where(inArray(categories.id, this.categoryIds));
      this.categoryIds.length = 0;
    }
    if (this.userIds.length > 0) {
      await testDb.delete(users).where(inArray(users.id, this.userIds));
      this.userIds.length = 0;
    }
  }
}
