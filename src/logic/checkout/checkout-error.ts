/**
 * A checkout that failed on a specific piece of the request — an unavailable
 * product, insufficient stock, an unknown province, an invalid/expired/exhausted
 * discount code. `field` names the offending line or field (`items.2`,
 * `address.provinceId`, `discountCode`) so the route can answer 422 with an
 * `errors[]` the client maps back to the input; `message` is the Persian,
 * customer-facing summary the envelope shows. It is deliberately distinct from a
 * thrown `Error` (which the route lets bubble to a 500): a `CheckoutError` is
 * expected, client-fixable input.
 *
 * Lives in its own module so both `create-order` and the discount policy
 * (`discount.ts`, which `create-order` imports) can throw it without a cycle.
 */
export class CheckoutError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}
