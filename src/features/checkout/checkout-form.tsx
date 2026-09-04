'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  ChevronRight,
  CreditCard,
  Shield,
  Wallet,
} from 'lucide-react';
import {
  cartTotal,
  clearCart,
  getCart,
  getServerCart,
  lineTotal,
  subscribe,
} from '@/features/storefront/cart/cart';
import { OrderSummary, type SummaryLine } from './order-summary';
import { ApiRequestError, postData } from '@/lib/api-client';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import { API_PATHS, PATHS, checkoutResultPath } from '@/lib/constant/paths';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import type { CheckoutResultResponse } from '@/lib/hono/routes/checkout';
import type { ShippingRateResponse } from '@/lib/hono/routes/shipping';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/orders/order-status';
import { toAsciiDigits, toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** idle → submitting → redirecting. The button disables off `idle`. */
type Status = 'idle' | 'submitting' | 'redirecting';

const STEPS = ['اطلاعات', 'آدرس', 'پرداخت'] as const;

const GENERIC_ERROR = 'ثبت سفارش انجام نشد. لطفاً دوباره تلاش کن.';

/** Which wizard step (1-based) a server/client field error belongs to. */
const STEP_OF_FIELD: Record<string, number> = {
  'address.recipientName': 1,
  'address.recipientPhone': 1,
  'address.provinceId': 2,
  'address.city': 2,
  'address.postalCode': 2,
  'address.addressLine': 2,
  paymentMethod: 3,
};

/** `items.*` / `discountCode` (and anything unlisted) live on the last step. */
const stepOfField = (path: string) => STEP_OF_FIELD[path] ?? 3;

/**
 * The ported checkout wizard: customer info → delivery address (province drives
 * the fee estimate) → payment method → submit.
 *
 * Money the shopper sees here is a display-only estimate from the localStorage
 * cart and the per-province `rates` prop; `POST /api/checkout` re-prices every
 * line server-side and its result is the only authoritative total. The cart
 * never leaves localStorage — the auth gate is the server page above this — so an
 * OTP round trip mid-checkout returns with it intact. On a created order the cart
 * is cleared immediately, before any gateway redirect.
 *
 * `rates`, the prefilled name/phone and any `savedAddresses` come from the server
 * page; the form validates the shape it sends against the shared `CheckoutInput`
 * type so it cannot drift from the route. Saved addresses power a "select a saved
 * address" prefill and a "save this address" option — both pure conveniences: the
 * order still snapshots whatever address is in the fields at submit, untouched.
 */
export function CheckoutForm({
  rates,
  defaultName,
  defaultPhone,
  savedAddresses = [],
}: {
  rates: ShippingRateResponse[];
  defaultName: string;
  defaultPhone: string;
  savedAddresses?: AddressResponse[];
}) {
  const router = useRouter();
  const fieldId = useId();

  // The cart is read through the store's hydration-safe snapshots — empty on the
  // server and the hydrating render, the real cart immediately after. `hydrated`
  // rides the same machinery so it flips in the same render the cart arrives in;
  // a passive `mounted` flag could lag it and briefly read a real empty cart as
  // "still loading".
  const lines = useSyncExternalStore(subscribe, getCart, getServerCart);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const [step, setStep] = useState(1);
  const [recipientName, setRecipientName] = useState(defaultName);
  const [recipientPhone, setRecipientPhone] = useState(defaultPhone);
  const [provinceId, setProvinceId] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS.ZARINPAL,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  // "Save this address" — a best-effort write after the order is created; a
  // failure never blocks the redirect (see `submit`).
  const [saveAddress, setSaveAddress] = useState(false);

  // The authoritative double-submit guard: set synchronously, so a second click
  // in the same tick returns before `postData` runs — the disabled button is
  // defense-in-depth, not the guarantee. Never sending a second create is the
  // point; the server-side `Idempotency-Key` is the last line if one slips out.
  const inFlight = useRef(false);
  // One key per checkout attempt, minted lazily on first submit, reused across
  // retries, and dropped only once an order is created (a 422 does not consume
  // it — nothing was created, so the retry must carry the same key).
  const idempotencyKey = useRef<string | null>(null);

  const selectedFee =
    rates.find((rate) => String(rate.provinceId) === provinceId)?.fee ?? null;
  const subtotal = cartTotal(lines);
  const estimatedTotal = subtotal + BigInt(selectedFee ?? 0);

  const summaryLines: SummaryLine[] = lines.map((line) => ({
    id: line.productId,
    title: line.title,
    qty: line.qty,
    lineTotal: lineTotal(line),
    imageKey: line.imageKey,
  }));

  // An empty cart is not a page to sit on — but only redirect once the real cart
  // has hydrated (never on the server-empty first render) and only while idle, so
  // the deliberate clear on a successful order does not bounce the shopper to the
  // shop instead of the result page.
  useEffect(() => {
    if (hydrated && status === 'idle' && lines.length === 0) {
      router.replace(PATHS.SHOP);
    }
  }, [hydrated, status, lines.length, router]);

  const clearError = (path: string) =>
    setFieldErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });

  /**
   * Fill every address field from a saved address. A saved address is a
   * `CheckoutAddressInput` plus an id/title, so this is a field-for-field copy —
   * the shared contract is what makes it one. Clears any errors on the fields it
   * touches; leaves "save this address" off (the address is already saved).
   */
  const applySavedAddress = (address: AddressResponse) => {
    setRecipientName(address.recipientName);
    setRecipientPhone(address.recipientPhone);
    setProvinceId(String(address.provinceId));
    setCity(address.city);
    setPostalCode(address.postalCode);
    setAddressLine(address.addressLine);
    setSaveAddress(false);
    setFieldErrors({});
  };

  /** Client-side gate for advancing a step — the server stays authoritative. */
  const validateStep = (which: number): boolean => {
    const errors: Record<string, string> = {};
    if (which === 1) {
      if (!recipientName.trim())
        errors['address.recipientName'] = 'نام گیرنده را وارد کن.';
      if (!recipientPhone.trim())
        errors['address.recipientPhone'] = 'شماره تماس گیرنده را وارد کن.';
    }
    if (which === 2) {
      if (!provinceId) errors['address.provinceId'] = 'استان را انتخاب کن.';
      if (!city.trim()) errors['address.city'] = 'شهر را وارد کن.';
      if (addressLine.trim().length < 10)
        errors['address.addressLine'] = 'آدرس کامل را وارد کن (حداقل ۱۰ حرف).';
      if (toAsciiDigits(postalCode).replace(/\D/g, '').length !== 10)
        errors['address.postalCode'] = 'کد پستی باید ۱۰ رقم باشد.';
    }
    setFieldErrors((prev) => ({ ...prev, ...errors }));
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length));
  };

  const submit = async () => {
    if (inFlight.current) return; // authoritative double-submit guard
    if (!validateStep(3)) return;
    inFlight.current = true;
    setStatus('submitting');
    setTopError(undefined);

    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

    const body: CheckoutInput = {
      items: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
      })),
      address: {
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        provinceId: Number(provinceId),
        city: city.trim(),
        postalCode: toAsciiDigits(postalCode).replace(/\D/g, ''),
        addressLine: addressLine.trim(),
      },
      paymentMethod,
    };

    try {
      const order = await postData<CheckoutResultResponse>(
        API_PATHS.CHECKOUT,
        body,
        { 'Idempotency-Key': idempotencyKey.current },
      );

      // 2xx: the order exists and its stock is reserved. Clear the local cart
      // NOW, before any gateway hop — an abandoned payment leaves a pending order
      // whose result page handles retry, and the cart is not involved again.
      clearCart();
      idempotencyKey.current = null; // consumed; a fresh checkout is a fresh key
      setStatus('redirecting');

      // Best-effort "save this address": the order already snapshotted the
      // address, so this only adds it to the address book. Swallowed on failure
      // (e.g. the per-user cap) — it must never block or fail the redirect below.
      if (saveAddress) {
        try {
          await postData<AddressResponse>(API_PATHS.ME_ADDRESSES, body.address);
        } catch {
          // intentionally ignored — checkout succeeded; saving is a convenience
        }
      }

      if (paymentMethod === PAYMENT_METHODS.ZARINPAL) {
        try {
          const { redirectUrl } = await postData<{ redirectUrl: string }>(
            API_PATHS.PAYMENT_REQUEST,
            { orderId: order.orderId },
          );
          window.location.assign(redirectUrl);
        } catch {
          // The order is created (pending_payment); starting the gateway failed.
          // Land on the result page — it shows "pending" and a retry button.
          router.push(checkoutResultPath(order.orderId));
        }
      } else {
        router.push(checkoutResultPath(order.orderId));
      }
    } catch (error) {
      // Nothing was created — release the guard, keep the key so the retry stays
      // idempotent, and re-enable the form.
      inFlight.current = false;
      setStatus('idle');

      // 422 (server refused a well-formed body) and 400 (body failed the zod
      // schema) both carry `field: message` errors — map either to its input.
      // Anything with no matching field (e.g. a missing-Idempotency-Key 400)
      // falls through to the top-level alert below via `unmapped`.
      if (
        error instanceof ApiRequestError &&
        (error.status === 422 || error.status === 400)
      ) {
        const { fields, unmapped } = parseFieldErrors(error.errors);
        setFieldErrors(fields);
        // Field errors on an input show inline; `items.*` (a cart line) and any
        // unmapped message have no input to attach to → the top-level alert.
        const itemMessages = Object.entries(fields)
          .filter(([path]) => path.startsWith('items.'))
          .map(([, message]) => message);
        const top = [...itemMessages, ...unmapped];
        setTopError(
          top.length > 0
            ? top.join(' ')
            : Object.keys(fields).length === 0
              ? error.message
              : undefined,
        );
        // Jump to the earliest step that has an error so it is on screen.
        const steps = Object.keys(fields).map(stepOfField);
        if (steps.length > 0) setStep(Math.min(...steps));
        return;
      }
      setTopError(error instanceof Error ? error.message : GENERIC_ERROR);
    }
  };

  const busy = status !== 'idle';
  const errorId = `${fieldId}-top-error`;

  return (
    <main className="bg-secondary/20 min-h-screen pt-20">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        <a
          href={PATHS.SHOP}
          className="text-muted-foreground hover:text-foreground mb-8 flex items-center gap-2 text-sm"
          data-umami-event="checkout-back-to-shop"
        >
          <ChevronRight size={14} aria-hidden="true" /> بازگشت به فروشگاه
        </a>

        <ol className="mb-10 flex items-center justify-center gap-1">
          {STEPS.map((label, index) => {
            const n = index + 1;
            return (
              <li
                key={label}
                className="flex items-center"
                aria-current={n === step ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full text-xs font-bold transition-colors',
                    n < step
                      ? 'bg-success text-white'
                      : n === step
                        ? 'bg-accent-strong text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {n < step ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    toPersianDigits(n)
                  )}
                </span>
                <span
                  className={cn(
                    'mx-2 hidden text-xs sm:inline',
                    n === step ? 'font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
                {index < STEPS.length - 1 && (
                  <span
                    className={cn(
                      'mx-1 h-0.5 w-8',
                      n < step ? 'bg-success' : 'bg-muted',
                    )}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="border-border bg-card rounded-2xl border p-6 lg:col-span-2">
            {topError && (
              <p
                id={errorId}
                role="alert"
                className="text-destructive border-destructive/30 bg-destructive-soft/40 mb-5 flex items-center gap-2 rounded-xl border p-3 text-sm"
              >
                <AlertCircle
                  size={16}
                  className="shrink-0"
                  aria-hidden="true"
                />
                {topError}
              </p>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="mb-1 text-xl font-bold">اطلاعات مشتری</h2>
                <p className="text-muted-foreground mb-5 text-sm">
                  از حساب کاربری‌ات پیش‌فرض شده — در صورت نیاز ویرایش کن.
                </p>
                {savedAddresses.length > 0 && (
                  <div>
                    <label
                      htmlFor={`${fieldId}-saved`}
                      className="mb-1.5 block text-sm font-medium"
                    >
                      انتخاب از آدرس‌های ذخیره‌شده
                    </label>
                    <select
                      id={`${fieldId}-saved`}
                      defaultValue=""
                      onChange={(event) => {
                        const address =
                          savedAddresses[Number(event.target.value)];
                        if (address) applySavedAddress(address);
                      }}
                      className="bg-secondary focus-visible:border-accent-strong border-border h-12 w-full rounded-xl border px-4 transition-colors outline-none focus-visible:ring-2"
                      data-umami-event="checkout-saved-address-select"
                    >
                      <option value="" disabled>
                        یک آدرس ذخیره‌شده را انتخاب کن
                      </option>
                      {savedAddresses.map((address, index) => (
                        <option key={address.id} value={index}>
                          {address.title ? `${address.title} — ` : ''}
                          {address.provinceName} · {address.city}
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      فیلدهای آدرس با انتخاب پر می‌شوند و قابل ویرایش‌اند.
                    </p>
                  </div>
                )}
                <TextField
                  id={`${fieldId}-name`}
                  label="نام و نام خانوادگی گیرنده"
                  value={recipientName}
                  onChange={(v) => {
                    setRecipientName(v);
                    clearError('address.recipientName');
                  }}
                  error={fieldErrors['address.recipientName']}
                  umami="checkout-recipient-name"
                />
                <TextField
                  id={`${fieldId}-phone`}
                  label="شماره تماس گیرنده"
                  value={recipientPhone}
                  onChange={(v) => {
                    setRecipientPhone(v);
                    clearError('address.recipientPhone');
                  }}
                  error={fieldErrors['address.recipientPhone']}
                  inputMode="tel"
                  dir="ltr"
                  umami="checkout-recipient-phone"
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="mb-5 text-xl font-bold">آدرس تحویل</h2>

                <div>
                  <label
                    htmlFor={`${fieldId}-province`}
                    className="mb-1.5 block text-sm font-medium"
                  >
                    استان
                  </label>
                  <select
                    id={`${fieldId}-province`}
                    value={provinceId}
                    onChange={(event) => {
                      setProvinceId(event.target.value);
                      clearError('address.provinceId');
                    }}
                    aria-invalid={Boolean(fieldErrors['address.provinceId'])}
                    aria-describedby={
                      fieldErrors['address.provinceId']
                        ? `${fieldId}-province-error`
                        : `${fieldId}-province-hint`
                    }
                    className={cn(
                      'bg-secondary focus-visible:border-accent-strong h-12 w-full rounded-xl border px-4 transition-colors outline-none focus-visible:ring-2',
                      fieldErrors['address.provinceId']
                        ? 'border-destructive'
                        : 'border-border',
                    )}
                    data-umami-event="checkout-province-change"
                  >
                    <option value="" disabled>
                      استان را انتخاب کن
                    </option>
                    {rates.map((rate) => (
                      <option key={rate.provinceId} value={rate.provinceId}>
                        {rate.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors['address.provinceId'] ? (
                    <p
                      id={`${fieldId}-province-error`}
                      className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
                    >
                      <AlertCircle size={12} aria-hidden="true" />{' '}
                      {fieldErrors['address.provinceId']}
                    </p>
                  ) : (
                    <p
                      id={`${fieldId}-province-hint`}
                      className="text-muted-foreground mt-1.5 text-xs"
                    >
                      هزینه ارسال بر اساس استان محاسبه می‌شود.
                    </p>
                  )}
                </div>

                <TextField
                  id={`${fieldId}-city`}
                  label="شهر"
                  value={city}
                  onChange={(v) => {
                    setCity(v);
                    clearError('address.city');
                  }}
                  error={fieldErrors['address.city']}
                  umami="checkout-city"
                />

                <div>
                  <label
                    htmlFor={`${fieldId}-address`}
                    className="mb-1.5 block text-sm font-medium"
                  >
                    آدرس کامل
                  </label>
                  <textarea
                    id={`${fieldId}-address`}
                    rows={3}
                    value={addressLine}
                    onChange={(event) => {
                      setAddressLine(event.target.value);
                      clearError('address.addressLine');
                    }}
                    placeholder="خیابان، کوچه، پلاک، واحد"
                    aria-invalid={Boolean(fieldErrors['address.addressLine'])}
                    aria-describedby={
                      fieldErrors['address.addressLine']
                        ? `${fieldId}-address-error`
                        : undefined
                    }
                    className={cn(
                      'bg-secondary focus-visible:border-accent-strong w-full rounded-xl border px-4 py-3 text-start transition-colors outline-none focus-visible:ring-2',
                      fieldErrors['address.addressLine']
                        ? 'border-destructive bg-destructive-soft/40'
                        : 'border-border',
                    )}
                    data-umami-event="checkout-address-line"
                  />
                  {fieldErrors['address.addressLine'] && (
                    <p
                      id={`${fieldId}-address-error`}
                      className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
                    >
                      <AlertCircle size={12} aria-hidden="true" />{' '}
                      {fieldErrors['address.addressLine']}
                    </p>
                  )}
                </div>

                <TextField
                  id={`${fieldId}-postal`}
                  label="کد پستی"
                  value={postalCode}
                  onChange={(v) => {
                    setPostalCode(v);
                    clearError('address.postalCode');
                  }}
                  error={fieldErrors['address.postalCode']}
                  hint="۱۰ رقم، بدون خط تیره"
                  inputMode="numeric"
                  dir="ltr"
                  umami="checkout-postal-code"
                />

                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={(event) => setSaveAddress(event.target.checked)}
                    className="accent-accent-strong size-4"
                    data-umami-event="checkout-save-address"
                  />
                  این آدرس را در حساب کاربری‌ام ذخیره کن
                </label>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="mb-5 text-xl font-bold">روش پرداخت</h2>
                <fieldset className="space-y-3">
                  <legend className="sr-only">روش پرداخت را انتخاب کن</legend>
                  {(
                    [
                      {
                        id: PAYMENT_METHODS.ZARINPAL,
                        label: 'پرداخت آنلاین (زرین‌پال)',
                        sub: 'انتقال به درگاه امن بانکی',
                        icon: <CreditCard size={18} aria-hidden="true" />,
                      },
                      {
                        id: PAYMENT_METHODS.COD,
                        label: 'پرداخت در محل',
                        sub: 'نقدی یا کارتخوان هنگام تحویل',
                        icon: <Wallet size={18} aria-hidden="true" />,
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.id}
                      htmlFor={`${fieldId}-pay-${option.id}`}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-colors',
                        paymentMethod === option.id
                          ? 'border-accent-strong bg-accent/5'
                          : 'border-border hover:border-accent/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        id={`${fieldId}-pay-${option.id}`}
                        value={option.id}
                        checked={paymentMethod === option.id}
                        onChange={() => setPaymentMethod(option.id)}
                        className="accent-accent-strong size-5"
                        data-umami-event={`checkout-payment-${option.id}`}
                      />
                      <span className="text-accent-strong">{option.icon}</span>
                      <span>
                        <span className="block font-medium">
                          {option.label}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {option.sub}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {paymentMethod === PAYMENT_METHODS.ZARINPAL ? (
                  <div className="bg-success-soft border-success/30 mt-5 flex items-center gap-3 rounded-2xl border p-5">
                    <Shield
                      size={20}
                      className="text-success-strong shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-sm">
                      اتصال امن به درگاه زرین‌پال. اطلاعات کارت شما نزد اسموکی
                      ذخیره نمی‌شود.
                    </p>
                  </div>
                ) : (
                  <div className="bg-warning-soft border-warning/30 mt-5 flex items-center gap-3 rounded-2xl border p-5">
                    <AlertCircle
                      size={20}
                      className="text-warning shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-sm">
                      مبلغ سفارش هنگام تحویل دریافت می‌شود. لطفاً در زمان ارسال
                      در دسترس باش.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={goNext}
                className="bg-accent-strong hover:bg-accent-hover mt-6 w-full rounded-xl py-3.5 font-bold text-white transition-colors"
                data-umami-event="checkout-step-next"
              >
                ادامه
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                aria-describedby={topError ? errorId : undefined}
                className="bg-accent-strong hover:bg-accent-hover mt-6 w-full rounded-xl py-3.5 font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                data-umami-event="checkout-submit-order"
              >
                {status === 'submitting'
                  ? 'در حال ثبت سفارش…'
                  : status === 'redirecting'
                    ? 'در حال انتقال…'
                    : paymentMethod === PAYMENT_METHODS.ZARINPAL
                      ? 'پرداخت و ثبت سفارش'
                      : 'ثبت سفارش'}
              </button>
            )}
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={busy}
                className="border-border hover:bg-secondary mt-3 w-full rounded-xl border-2 py-3 font-medium transition-colors disabled:opacity-60"
                data-umami-event="checkout-step-back"
              >
                مرحله قبل
              </button>
            )}
          </div>

          <div className="bg-card border-border h-fit rounded-2xl border p-5">
            <h2 className="mb-4 font-bold">خلاصه سفارش</h2>
            <OrderSummary
              lines={summaryLines}
              subtotal={subtotal}
              shippingFee={selectedFee}
              total={estimatedTotal}
            />
            <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
              مبلغ نهایی هنگام ثبت سفارش توسط سرور دوباره محاسبه می‌شود.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

/** The one text-input pattern the wizard reuses: label, control, inline error. */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  inputMode,
  dir,
  umami,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  inputMode?: 'text' | 'tel' | 'numeric';
  dir?: 'ltr' | 'rtl';
  umami: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        dir={dir}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          'bg-secondary focus-visible:border-accent-strong w-full rounded-xl border px-4 py-3 text-start transition-colors outline-none focus-visible:ring-2',
          error ? 'border-destructive bg-destructive-soft/40' : 'border-border',
        )}
        data-umami-event={umami}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
        >
          <AlertCircle size={12} className="shrink-0" aria-hidden="true" />{' '}
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
