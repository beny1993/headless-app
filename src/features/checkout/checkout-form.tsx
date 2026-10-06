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
import { CardToCardPanel, type CardToCardContent } from './card-to-card';
import {
  checkoutKeyFor,
  forgetCheckoutKey,
  type KeptKey,
} from './checkout-key';
import { OrderSummary, type SummaryLine } from './order-summary';
import { ReceiptPicker } from './receipt-picker';
import {
  controlClass,
  fieldAria,
  FieldShell,
  TextField,
} from '@/components/ui/field';
import { ApiRequestError, postData, postForm } from '@/lib/api-client';
import { normalizePostalCode, validateAddress } from '@/lib/account/address';
import { reasonFrom, requestFieldErrors } from '@/lib/checkout/field-errors';
import { REFUND_SENTENCE } from '@/lib/checkout/result-view';
import { startZarinpalPayment } from '@/lib/checkout/start-zarinpal-payment';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import {
  API_PATHS,
  PATHS,
  apiOrderReceiptsPath,
  checkoutResultPath,
} from '@/lib/constant/paths';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import type {
  CheckoutResultResponse,
  DiscountPreviewResponse,
} from '@/lib/hono/routes/checkout';
import type { ShippingRateResponse } from '@/lib/hono/routes/shipping';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { RECEIPT_UPLOAD_FAILED, receiptSchema } from '@/lib/orders/receipt';
import { toPersianDigits } from '@/lib/format';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';
import { IMAGE_FIELD_NAME } from '@/lib/storage/image-upload';
import { cn } from '@/lib/utils';

/**
 * idle → submitting → (uploading, card to card) → redirecting. The button
 * disables off `idle`, and only a refused create ever returns to it. A
 * screenshot that fails to store parks the form at `receipt-failed`, from
 * where the button only resends it to the order already created.
 */
type Status =
  'idle' | 'submitting' | 'uploading' | 'receipt-failed' | 'redirecting';

/**
 * The server's own sentence for a refused receipt — a 4xx: the order moved on,
 * or the file was refused — else a generic one. A 5xx message is a
 * developer's, never a shopper's.
 */
const receiptRefusal = (error: unknown): string =>
  error instanceof ApiRequestError && error.status < 500
    ? error.message
    : RECEIPT_UPLOAD_FAILED;

const STEPS = ['اطلاعات', 'آدرس', 'پرداخت'] as const;

const GENERIC_ERROR = 'ثبت سفارش انجام نشد. لطفاً دوباره تلاش کن.';

const PROVINCE_HINT = 'هزینه ارسال بر اساس استان محاسبه می‌شود.';

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
 * type so it cannot drift from the route. A saved address is a complete
 * `CheckoutAddressInput`, so picking one on the first step fills every field AND
 * skips the address step (payment comes next; «مرحله قبل» returns to the first
 * step) — unless its province has since been deactivated, in which case the
 * address step stays to say so. «آدرس جدید», the default, keeps the address step.
 * That and the "save this address" option are pure conveniences: the order still
 * snapshots whatever address is in the fields at submit, untouched.
 *
 * `payment` is the `checkout.payment` content block: the card-to-card cards and
 * contact handles the last step shows under that option, with the picker for
 * the transfer's screenshot under them — «ثبت سفارش» stays locked until one
 * passes the byte check. The stored method stays `cod`: the order is created
 * waiting for its receipt, and the screenshot, uploaded right after the create
 * to the order's receipt route, accepts it.
 * `zarinpalEnabled` (`APP_CONFIG_ZARINPAL_ENABLED`, read by the page) is the
 * online-payment switch: off, the Zarinpal option renders disabled and card to
 * card is preselected — a display gate only; the API still accepts both methods.
 */
export function CheckoutForm({
  rates,
  defaultName,
  defaultPhone,
  savedAddresses = [],
  payment,
  zarinpalEnabled = true,
}: {
  rates: ShippingRateResponse[];
  defaultName: string;
  defaultPhone: string;
  savedAddresses?: AddressResponse[];
  payment: CardToCardContent;
  zarinpalEnabled?: boolean;
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
  // '' is «آدرس جدید»; otherwise the index into `savedAddresses` of the picked
  // one. Only the pick is remembered — the fields it filled are the state the
  // order is built from, and stay editable on the address step.
  const [savedIndex, setSavedIndex] = useState('');
  const [recipientName, setRecipientName] = useState(defaultName);
  const [recipientPhone, setRecipientPhone] = useState(defaultPhone);
  const [provinceId, setProvinceId] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    zarinpalEnabled ? PAYMENT_METHODS.ZARINPAL : PAYMENT_METHODS.COD,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | undefined>();
  // A create that got no answer — a 5xx, a dropped connection — may have
  // placed the order: the alert says to look before trying again.
  const [orderMayExist, setOrderMayExist] = useState(false);
  // Counts refused creates, so each one moves focus (the effect below).
  const [refusals, setRefusals] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  // "Save this address" — a best-effort write after the order is created; a
  // failure never blocks the redirect (see `submit`).
  const [saveAddress, setSaveAddress] = useState(false);
  // Discount code. `applied` holds the SERVER-computed preview ({subtotal,
  // discount}) tagged with the code and cart it was computed for; the amount the
  // shopper sees is never client-computed. Its validity is DERIVED at render
  // (`activeDiscount` below) rather than cleared in an effect: a preview only
  // counts while the code text and the cart still match what it was computed
  // against, so a changed code or cart drops it with no cascading re-render. The
  // order re-validates and claims the code atomically at submit regardless.
  const [discountCode, setDiscountCode] = useState('');
  const [applied, setApplied] = useState<
    (DiscountPreviewResponse & { code: string; signature: string }) | null
  >(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  // The card-to-card transfer's screenshot: a file that passed the byte check,
  // or the refusal of the last one picked.
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  // A card-to-card order this form created whose screenshot did not store:
  // the form stays to resend it to this order — never to create another —
  // and the summary shows the order, the cart being already cleared.
  const [placed, setPlaced] = useState<{
    orderId: string;
    address: CheckoutInput['address'];
    lines: SummaryLine[];
    subtotal: number;
    discount: number;
    shippingFee: number;
    total: number;
  } | null>(null);
  // The resend's own double-click guard; `inFlight` stays set once an order
  // exists, so the create can never run again.
  const resending = useRef(false);

  // The authoritative double-submit guard: set synchronously, so a second click
  // in the same tick returns before `postData` runs — the disabled button is
  // defense-in-depth, not the guarantee. Never sending a second create is the
  // point; the server-side `Idempotency-Key` is the last line if one slips out.
  const inFlight = useRef(false);
  const topAlert = useRef<HTMLParagraphElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLElement>(null);
  // The Idempotency-Keys, one per checkout body: a key is resent by every
  // retry of its body — after a reload too (`checkout-key.ts`) — and dropped
  // once its order is created. A refusal does not consume it, so the retry
  // carries the same key. This is their in-memory copy, for when storage
  // throws.
  const keptKeys = useRef<KeptKey[]>([]);

  const selectedFee =
    rates.find((rate) => String(rate.provinceId) === provinceId)?.fee ?? null;
  // A saved-address prefill onto a province the admin has since deactivated:
  // `rates` holds only active provinces, so no option matches the stale id and
  // React would display the first enabled one («تهران») — which re-picking fires
  // no change for. The select gets '' instead, showing its placeholder. Derived
  // at render; `validateStep(2)` blocks «ادامه» on it — `POST /api/checkout`'s
  // 422 is the backstop.
  const staleProvince =
    provinceId !== '' &&
    !rates.some((rate) => String(rate.provinceId) === provinceId);
  const provinceError =
    fieldErrors['address.provinceId'] ??
    (staleProvince ? STALE_PROVINCE_MESSAGE : undefined);
  // A picked saved address on an active province leaves the address step
  // nothing to ask, so the wizard steps over it in both directions. A stale
  // province keeps the step: the shopper has to pick another one there.
  const skipAddress = savedIndex !== '' && !staleProvince;
  const clientSubtotal = cartTotal(lines);

  // A stable signature of the cart contents. The applied preview is valid only
  // while both the code text and this signature still match what it was computed
  // for — derived here, so a changed code or cart drops the shown discount at
  // render with no effect and no cascading update.
  const cartSignature = lines
    .map((line) => `${line.productId}:${line.qty}`)
    .join('|');
  const activeDiscount =
    applied &&
    applied.code === discountCode.trim() &&
    applied.signature === cartSignature
      ? applied
      : null;

  // When a code is applied, show the SERVER's subtotal + discount so the total
  // always adds up (a price could have drifted since the cart was built); with no
  // code, the client cart estimate. The order-creation response stays the sole
  // authority on the real charge either way.
  const subtotalForDisplay = activeDiscount
    ? BigInt(activeDiscount.subtotal)
    : clientSubtotal;
  const discountForDisplay = activeDiscount
    ? BigInt(activeDiscount.discount)
    : null;
  const estimatedTotal =
    subtotalForDisplay - (discountForDisplay ?? 0n) + BigInt(selectedFee ?? 0);

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

  // After a refused create, focus what it says: its alert, which tops the
  // form far above the button that sent it — or, when the refusal shows only
  // on fields, the first field to fix. Focus also moves a screen reader there;
  // the scroll centres it, clear of the fixed header.
  useEffect(() => {
    if (refusals === 0) return;
    const target =
      topAlert.current ??
      page.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
  }, [refusals]);

  // A failed upload hands focus back to the button that resends it: it was
  // disabled while the upload ran, which dropped focus to <body>. The
  // picker's alert reads the refusal out on its own.
  useEffect(() => {
    if (status === 'receipt-failed') submitButton.current?.focus();
  }, [status]);

  /**
   * Ask the server what the code takes off the current cart. Read-only — it never
   * creates an order or consumes a use; the authoritative claim happens at submit.
   * The displayed discount is whatever the server returns, never computed here.
   * The result is tagged with the code + cart signature so `activeDiscount` can
   * drop it the moment either changes.
   */
  const applyCode = async () => {
    const trimmed = discountCode.trim();
    if (!trimmed || applying) return;
    setApplying(true);
    setDiscountError(null);
    try {
      const result = await postData<DiscountPreviewResponse>(
        API_PATHS.CHECKOUT_PREVIEW,
        {
          items: lines.map((line) => ({
            productId: line.productId,
            qty: line.qty,
          })),
          discountCode: trimmed,
        },
      );
      setApplied({ ...result, code: trimmed, signature: cartSignature });
    } catch (error) {
      setApplied(null);
      const { fields, message } = requestFieldErrors(error, GENERIC_ERROR);
      // Another field's entry is a 400's English zod text; the envelope's own
      // `message` is the Persian sentence for it.
      setDiscountError(
        fields.discountCode ?? message ?? reasonFrom(error) ?? GENERIC_ERROR,
      );
    } finally {
      setApplying(false);
    }
  };

  const clearError = (path: string) =>
    setFieldErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });

  /**
   * Fill every address field from the saved address at `index`. A saved address
   * is a `CheckoutAddressInput` plus an id/title, so this is a field-for-field
   * copy — the shared contract is what makes it one. Clears any errors on the
   * fields it touches; leaves "save this address" off (the address is already
   * saved).
   */
  const applySavedAddress = (index: string) => {
    const address = savedAddresses[Number(index)];
    if (!address) return;
    setSavedIndex(index);
    setRecipientName(address.recipientName);
    setRecipientPhone(address.recipientPhone);
    setProvinceId(String(address.provinceId));
    setCity(address.city);
    setPostalCode(address.postalCode);
    setAddressLine(address.addressLine);
    setSaveAddress(false);
    setFieldErrors({});
  };

  /**
   * «آدرس جدید» after a saved address: the address step is back, so it starts
   * blank rather than showing the saved address it no longer means. Name and
   * phone stay — they sit on this step, in view and editable.
   */
  const startNewAddress = () => {
    setSavedIndex('');
    setProvinceId('');
    setCity('');
    setPostalCode('');
    setAddressLine('');
    setFieldErrors({});
  };

  /** Client-side gate for advancing a step — the server stays authoritative. */
  const validateStep = (which: number): boolean => {
    const errors: Record<string, string> = {};
    const address = {
      recipientName,
      recipientPhone,
      provinceId,
      city,
      postalCode,
      addressLine,
    };
    // One rule set for the whole address; each step reports only its own fields.
    for (const [field, message] of Object.entries(
      validateAddress(address, staleProvince),
    )) {
      const path = `address.${field}`;
      if (stepOfField(path) === which) errors[path] = message;
    }
    setFieldErrors((prev) => ({ ...prev, ...errors }));
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep(step === 1 && skipAddress ? 3 : Math.min(step + 1, STEPS.length));
  };

  const goBack = () =>
    setStep(step === 3 && skipAddress ? 1 : Math.max(1, step - 1));

  /** Stores the screenshot on the order; on failure says why, under the picker. */
  const storeReceipt = async (orderId: string, file: File) => {
    setStatus('uploading');
    try {
      const form = new FormData();
      // Named «receipt», never the shopper's own file name.
      form.append(IMAGE_FIELD_NAME, file, 'receipt');
      await postForm(apiOrderReceiptsPath(orderId), form, receiptSchema);
      return true;
    } catch (error) {
      setReceiptError(receiptRefusal(error));
      setStatus('receipt-failed');
      return false;
    }
  };

  // Best-effort "save this address": the order already snapshotted the
  // address, so this only adds it to the address book. Swallowed on failure
  // (e.g. the per-user cap) — it must never block or fail the redirect after.
  const saveToAddressBook = async (address: CheckoutInput['address']) => {
    if (!saveAddress) return;
    try {
      await postData<AddressResponse>(API_PATHS.ME_ADDRESSES, address);
    } catch {
      // intentionally ignored — checkout succeeded; saving is a convenience
    }
  };

  /** «ارسال دوباره رسید»: the screenshot again, to the order already created. */
  const resendReceipt = async () => {
    if (!placed || !receipt || resending.current) return;
    resending.current = true;
    const stored = await storeReceipt(placed.orderId, receipt);
    resending.current = false;
    if (!stored) return;
    setStatus('redirecting');
    await saveToAddressBook(placed.address);
    router.push(checkoutResultPath(placed.orderId));
  };

  const submit = async () => {
    if (inFlight.current) return; // authoritative double-submit guard
    if (!validateStep(3)) return;
    inFlight.current = true;
    setStatus('submitting');
    setTopError(undefined);
    setOrderMayExist(false);

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
        postalCode: normalizePostalCode(postalCode),
        addressLine: addressLine.trim(),
      },
      paymentMethod,
      // Only when a code is present — the server re-validates and claims it
      // atomically, whatever the preview showed.
      ...(discountCode.trim() ? { discountCode: discountCode.trim() } : {}),
    };

    const idempotencyKey = await checkoutKeyFor(JSON.stringify(body), keptKeys);

    // The create is the only call whose failure re-enables the form: nothing
    // after its 2xx may, or a retry would place a second order.
    let order: CheckoutResultResponse;
    try {
      order = await postData<CheckoutResultResponse>(API_PATHS.CHECKOUT, body, {
        'Idempotency-Key': idempotencyKey,
      });
    } catch (error) {
      // No order this form knows of — release the guard, keep the key so a
      // retry of the same checkout stays idempotent, and re-enable the form.
      inFlight.current = false;
      setStatus('idle');

      // 422 (server refused a well-formed body) and 400 (body failed the zod
      // schema) both carry `field: message` errors — map either to its input.
      // Anything with no matching field (e.g. a missing-Idempotency-Key 400)
      // is the request's own `message`, for the top-level alert below.
      const { fields, message } = requestFieldErrors(error, GENERIC_ERROR);
      setFieldErrors(fields);
      // A discountCode error belongs on the code input (in the summary card),
      // not the wizard steps — surface it there and drop any stale preview.
      if (fields.discountCode) {
        setApplied(null);
        setDiscountError(fields.discountCode);
      }
      // Field errors on an input show inline; everything else goes to the
      // top-level alert: `items.*` (a cart line), `paymentMethod` (where
      // createOrder's per-user caps and the online-payment refusal land — the
      // payment radios have no error slot, so the message would otherwise be
      // parsed, kept, and shown nowhere) and the request's own message.
      const top = Object.entries(fields)
        .filter(
          ([path]) => path.startsWith('items.') || path === 'paymentMethod',
        )
        .map(([, fieldMessage]) => fieldMessage);
      if (message) top.push(message);
      // A 4xx is the server's refusal: nothing was created. Anything else — a
      // 5xx, a dropped connection — leaves the outcome unknown and the order
      // may exist, so the alert says to look before trying again instead.
      const refused =
        error instanceof ApiRequestError &&
        error.status >= 400 &&
        error.status < 500;
      // The refund line goes only beside a refusal that blocks the order —
      // a cart line, the method or a cap, the request's own message — where
      // a card-to-card shopper may have transferred already. A refusal of
      // fields they can fix has none: it shows on those fields.
      if (refused && paymentMethod === PAYMENT_METHODS.COD && top.length > 0) {
        top.push(REFUND_SENTENCE);
      }
      setOrderMayExist(!refused);
      setTopError(refused && top.length > 0 ? top.join(' ') : undefined);
      // Jump to the earliest step that has an error so it is on screen.
      const steps = Object.keys(fields).map(stepOfField);
      if (steps.length > 0) setStep(Math.min(...steps));
      setRefusals((count) => count + 1);
      return;
    }

    // 2xx: the order exists and its stock is reserved. From here every path
    // ends on this order's own page. The cart is cleared first, before the
    // upload or any gateway hop: an empty cart sends a fresh /checkout to the
    // shop (the effect above), so it offers nothing to submit again.
    clearCart();
    forgetCheckoutKey(idempotencyKey, keptKeys); // consumed: this body is new again
    // The answer's status and the method on screen decide what follows: the
    // upload only for card to card answered `awaiting_receipt`, the gateway
    // only for Zarinpal answered `pending_payment`, and anything else
    // straight to the order's page.
    const screenshot =
      order.status === ORDER_STATUSES.AWAITING_RECEIPT &&
      paymentMethod === PAYMENT_METHODS.COD
        ? receipt
        : null;
    const toGateway =
      order.status === ORDER_STATUSES.PENDING_PAYMENT &&
      paymentMethod === PAYMENT_METHODS.ZARINPAL;
    setStatus(screenshot ? 'uploading' : 'redirecting');

    // The screenshot accepts the card-to-card order. A refusal or a dropped
    // connection keeps the shopper here, the refusal under the picker, to
    // resend it to this same order (`resendReceipt`).
    if (screenshot && !(await storeReceipt(order.orderId, screenshot))) {
      setPlaced({
        orderId: order.orderId,
        address: body.address,
        lines: summaryLines,
        subtotal: order.subtotal,
        discount: order.discount,
        shippingFee: order.shippingFee,
        total: order.total,
      });
      return;
    }
    setStatus('redirecting');
    await saveToAddressBook(body.address);

    if (toGateway) {
      try {
        await startZarinpalPayment(order.orderId);
      } catch {
        // The order is created (pending_payment); starting the gateway failed.
        // Land on the result page — it shows "pending" and a retry button.
        router.push(checkoutResultPath(order.orderId));
      }
    } else {
      router.push(checkoutResultPath(order.orderId));
    }
  };

  const busy = status !== 'idle';
  const errorId = `${fieldId}-top-error`;

  return (
    <main ref={page} className="bg-secondary/20 min-h-screen pt-20">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
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

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="border-border bg-card rounded-2xl border p-6 lg:col-span-3">
            {(topError || orderMayExist) && (
              <p
                id={errorId}
                ref={topAlert}
                tabIndex={-1}
                role="alert"
                className="text-destructive border-destructive/30 bg-destructive-soft/40 mb-5 flex items-center gap-2 rounded-xl border p-3 text-sm"
              >
                <AlertCircle
                  size={16}
                  className="shrink-0"
                  aria-hidden="true"
                />
                {orderMayExist ? (
                  <span>
                    ممکن است سفارش ثبت شده باشد؛ پیش از تلاش دوباره، «
                    <a
                      href={PATHS.ACCOUNT}
                      className="font-medium underline"
                      data-umami-event="checkout-error-my-orders"
                    >
                      سفارش‌های من
                    </a>
                    » را ببین.
                  </span>
                ) : (
                  topError
                )}
              </p>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="mb-1 text-xl font-bold">اطلاعات مشتری</h2>
                <p className="text-muted-foreground mb-5 text-sm">
                  نام گیرنده را بنویس — شماره تماس از حساب کاربری‌ات آمده و قابل
                  ویرایش است.
                </p>
                {savedAddresses.length > 0 && (
                  <FieldShell
                    id={`${fieldId}-saved`}
                    label="آدرس تحویل"
                    hint="با انتخاب آدرس ذخیره‌شده، مستقیم به مرحله پرداخت می‌روی."
                  >
                    <select
                      id={`${fieldId}-saved`}
                      value={savedIndex}
                      onChange={(event) =>
                        event.target.value === ''
                          ? startNewAddress()
                          : applySavedAddress(event.target.value)
                      }
                      className={controlClass(false)}
                      data-umami-event="checkout-saved-address-select"
                    >
                      <option value="">آدرس جدید</option>
                      {savedAddresses.map((address, index) => (
                        <option key={address.id} value={index}>
                          {address.title ? `${address.title} — ` : ''}
                          {address.provinceName} · {address.city}
                        </option>
                      ))}
                    </select>
                  </FieldShell>
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

                <FieldShell
                  id={`${fieldId}-province`}
                  label="استان"
                  error={provinceError}
                  hint={PROVINCE_HINT}
                >
                  <select
                    id={`${fieldId}-province`}
                    value={staleProvince ? '' : provinceId}
                    onChange={(event) => {
                      setProvinceId(event.target.value);
                      clearError('address.provinceId');
                    }}
                    {...fieldAria(
                      `${fieldId}-province`,
                      provinceError,
                      PROVINCE_HINT,
                    )}
                    className={controlClass(Boolean(provinceError))}
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
                </FieldShell>

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

                <FieldShell
                  id={`${fieldId}-address`}
                  label="آدرس کامل"
                  error={fieldErrors['address.addressLine']}
                >
                  <textarea
                    id={`${fieldId}-address`}
                    rows={3}
                    value={addressLine}
                    onChange={(event) => {
                      setAddressLine(event.target.value);
                      clearError('address.addressLine');
                    }}
                    placeholder="خیابان، کوچه، پلاک، واحد"
                    {...fieldAria(
                      `${fieldId}-address`,
                      fieldErrors['address.addressLine'],
                    )}
                    className={controlClass(
                      Boolean(fieldErrors['address.addressLine']),
                    )}
                    data-umami-event="checkout-address-line"
                  />
                </FieldShell>

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
                        sub: zarinpalEnabled
                          ? 'انتقال به درگاه امن بانکی'
                          : 'در حال حاضر غیرفعال است',
                        icon: <CreditCard size={18} aria-hidden="true" />,
                        disabled: !zarinpalEnabled,
                      },
                      {
                        id: PAYMENT_METHODS.COD,
                        label: 'پرداخت توسط کارت به کارت',
                        sub: 'واریز به کارت فروشگاه و بارگذاری رسید',
                        icon: <Wallet size={18} aria-hidden="true" />,
                        disabled: false,
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.id}
                      htmlFor={`${fieldId}-pay-${option.id}`}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border-2 p-4 transition-colors',
                        option.disabled
                          ? 'border-border cursor-not-allowed opacity-60'
                          : paymentMethod === option.id
                            ? 'border-accent-strong bg-accent/5 cursor-pointer'
                            : 'border-border hover:border-accent/50 cursor-pointer',
                      )}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        id={`${fieldId}-pay-${option.id}`}
                        value={option.id}
                        checked={paymentMethod === option.id}
                        // Locked once the order exists: it was created with
                        // this method.
                        disabled={option.disabled || placed !== null}
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
                  <>
                    <CardToCardPanel payment={payment} className="mt-5" />
                    <p className="mt-5 mb-3 text-sm leading-relaxed">
                      پس از واریز، اسکرین‌شات رسید را همین‌جا پیوست کن؛ سفارش
                      فقط با رسید واریز پذیرفته می‌شود.
                    </p>
                    <ReceiptPicker
                      id={`${fieldId}-receipt`}
                      event="checkout-receipt-file"
                      file={receipt}
                      error={receiptError}
                      disabled={busy && status !== 'receipt-failed'}
                      onPick={(pick) => {
                        setReceipt(pick.file);
                        setReceiptError(pick.error);
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={goNext}
                className="bg-brand hover:bg-brand-hover text-brand-foreground mt-6 w-full rounded-xl py-3.5 font-bold transition-colors"
                data-umami-event="checkout-step-next"
              >
                ادامه
              </button>
            ) : (
              <button
                ref={submitButton}
                type="button"
                onClick={placed ? resendReceipt : submit}
                disabled={
                  placed
                    ? status !== 'receipt-failed' || !receipt
                    : busy ||
                      (paymentMethod === PAYMENT_METHODS.COD && !receipt)
                }
                aria-describedby={
                  topError || orderMayExist ? errorId : undefined
                }
                className="bg-brand hover:bg-brand-hover text-brand-foreground mt-6 w-full rounded-xl py-3.5 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                data-umami-event="checkout-submit-order"
              >
                {status === 'submitting'
                  ? 'در حال ثبت سفارش…'
                  : status === 'uploading'
                    ? 'در حال ارسال رسید…'
                    : status === 'receipt-failed'
                      ? 'ارسال دوباره رسید'
                      : status === 'redirecting'
                        ? 'در حال انتقال…'
                        : paymentMethod === PAYMENT_METHODS.ZARINPAL
                          ? 'پرداخت و ثبت سفارش'
                          : 'ثبت سفارش'}
              </button>
            )}
            {placed && (
              <p className="text-muted-foreground mt-3 text-center text-sm">
                سفارش ثبت شده و منتظر رسید است.{' '}
                <a
                  href={checkoutResultPath(placed.orderId)}
                  className="text-foreground font-medium underline"
                  data-umami-event="checkout-receipt-view-order"
                >
                  مشاهده سفارش
                </a>
              </p>
            )}
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="border-border hover:bg-secondary mt-3 w-full rounded-xl border-2 py-3 font-medium transition-colors disabled:opacity-60"
                data-umami-event="checkout-step-back"
              >
                مرحله قبل
              </button>
            )}
          </div>

          <div className="bg-card border-border h-fit rounded-2xl border p-5 lg:col-span-2 lg:p-6">
            <h2 className="mb-4 font-bold">خلاصه سفارش</h2>

            {/* Not once the order exists: it was placed at its discount. */}
            {!placed && (
              <div className="mb-4">
                <label
                  htmlFor={`${fieldId}-discount`}
                  className="mb-1.5 block text-sm font-medium"
                >
                  کد تخفیف
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${fieldId}-discount`}
                    type="text"
                    dir="ltr"
                    value={discountCode}
                    onChange={(event) => {
                      setDiscountCode(event.target.value);
                      // `activeDiscount` already stops matching once the text
                      // differs from what was applied; just clear any stale error.
                      setDiscountError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void applyCode();
                      }
                    }}
                    placeholder="کد را وارد کن"
                    aria-invalid={Boolean(discountError)}
                    aria-describedby={
                      discountError ? `${fieldId}-discount-error` : undefined
                    }
                    className={cn(
                      controlClass(Boolean(discountError)),
                      'h-11 min-w-0 flex-1 px-3 py-0 text-end',
                    )}
                    data-umami-event="checkout-discount-code"
                  />
                  <button
                    type="button"
                    onClick={applyCode}
                    disabled={applying || discountCode.trim() === ''}
                    className="border-accent-strong text-accent-strong hover:bg-accent/5 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    data-umami-event="checkout-discount-apply"
                  >
                    {applying ? '...' : 'اعمال'}
                  </button>
                </div>
                {discountError ? (
                  <p
                    id={`${fieldId}-discount-error`}
                    role="alert"
                    className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
                  >
                    <AlertCircle
                      size={12}
                      className="shrink-0"
                      aria-hidden="true"
                    />{' '}
                    {discountError}
                  </p>
                ) : activeDiscount && activeDiscount.discount > 0 ? (
                  <p className="text-success-strong mt-1.5 flex items-center gap-1 text-xs">
                    <Check size={12} className="shrink-0" aria-hidden="true" />{' '}
                    کد تخفیف اعمال شد.
                  </p>
                ) : activeDiscount ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    این کد برای سبد فعلی تخفیفی ندارد.
                  </p>
                ) : null}
              </div>
            )}

            {placed ? (
              <OrderSummary
                lines={placed.lines}
                subtotal={placed.subtotal}
                discount={placed.discount}
                shippingFee={placed.shippingFee}
                total={placed.total}
              />
            ) : (
              <OrderSummary
                lines={summaryLines}
                subtotal={subtotalForDisplay}
                discount={discountForDisplay}
                shippingFee={selectedFee}
                total={estimatedTotal}
              />
            )}
            <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
              مبلغ نهایی هنگام ثبت سفارش توسط سرور دوباره محاسبه می‌شود.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
