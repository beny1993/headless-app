'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ChevronRight,
  Clock,
  MessageSquare,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import {
  CANONICAL_PHONE_EXAMPLE,
  INVALID_PHONE_MESSAGE,
  normalizeIranPhone,
  toLocalIranPhone,
} from '@/lib/auth/phone';
import { otpEchoResponseSchema } from '@/lib/auth/otp-echo';
import {
  OTP_CODE_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
} from '@/lib/auth/otp-throttle';
import { normalizeSearchText } from '@/lib/catalog/search-text';
import { PATHS } from '@/lib/constant/paths';
import { formatNumber, toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * How long before «ارسال دوباره کد» comes back.
 *
 * Derived from the server's cooldown rather than restated, so it stays longer
 * than it if that ever moves: a button that appears before the server will
 * accept it is a button that reliably fails. Erring the other way costs half a
 * minute of waiting and nothing else.
 */
const RESEND_SECONDS = OTP_RESEND_COOLDOWN_SECONDS + 30;

const MESSAGES = {
  wrongCode: 'کد وارد شده صحیح نیست یا منقضی شده است.',
  tooManyAttempts: 'تعداد تلاش‌ها زیاد شد. کد تازه بگیر.',
  throttled: 'برای درخواست کد جدید کمی صبر کن.',
  offline: 'ارتباط با سرور برقرار نشد. دوباره تلاش کن.',
} as const;

/** ASCII digits only — Persian and Arabic-Indic fold through the shared normalizer. */
const digitsOnly = (value: string) =>
  normalizeSearchText(value).replace(/\D/g, '');

/** `۰۱:۳۰` — the countdown, in Persian digits and never with a separator. */
const formatCountdown = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${toPersianDigits(minutes)}:${toPersianDigits(seconds)}`;
};

/**
 * Better Auth answers in English error codes. The status is the honest thing to
 * branch on — the strings are the library's, and would change under us.
 */
const messageForStatus = (status: number | undefined, fallback: string) => {
  if (status === 429) return MESSAGES.throttled;
  if (status === 403) return MESSAGES.tooManyAttempts;
  // A server fault is not the shopper's mistake. Without this, a database blip
  // on send tells someone their phone number is invalid — a number this form
  // already validated before it sent anything — and on verify it tells them
  // their code is wrong and wipes the boxes they just filled.
  if (status !== undefined && status >= 500) return MESSAGES.offline;
  return status ? fallback : MESSAGES.offline;
};

type Step = 'phone' | 'code';

/** Six empty boxes. A fresh array each time — this is mutated in place below. */
const emptyCode = () => Array.from({ length: OTP_CODE_LENGTH }, () => '');

/**
 * The storefront's only sign-in: a phone number, then the six digits texted to
 * it. Ported from the prototype's `LoginPage`.
 *
 * The number is normalized **here**, before it is sent. The API accepts nothing
 * but the canonical `+989xxxxxxxxx` (see `src/lib/auth/phone.ts`), so this is
 * the step that lets a shopper type `۰۹۱۲…` or `0912 123 4567` and still land
 * on the one account that is theirs.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const fieldId = useId();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Only ever set on staging/local, where the server echoes the code back
  // instead of texting it (src/lib/auth/otp-echo.ts). Empty in production
  // because the field is not in the response.
  const [devCode, setDevCode] = useState<string | undefined>();

  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const phoneField = useRef<HTMLInputElement>(null);
  // The code as the boxes currently hold it, readable synchronously. Two
  // keystrokes landing in one React batch both read `digits` from their own
  // closure, so the second would overwrite the first; a ref is updated the
  // moment the event runs and composes correctly.
  const entered = useRef<string[]>(emptyCode());

  const code = digits.join('');
  const isComplete = !digits.includes('');

  /** Writes both halves, so the ref never lags the render. */
  const putCode = (value: string[]) => {
    entered.current = value;
    setDigits(value);
  };

  // One `setTimeout` a second, not an interval: it restarts cleanly whenever a
  // resend puts a new number on the clock, and it is the only timer this
  // component owns, so its tests can fake exactly that.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Changing step swaps the whole form out, and the control that was focused
  // goes with it — focus lands on `<body>`, so a keyboard user tabs from the
  // top of the document and a screen-reader user is told nothing happened.
  // Deliberately not on first render: a login page that grabs focus on load
  // scrolls the viewport out from under a shopper who is still reading.
  //
  // Compares against the previous step rather than flagging "have I run
  // before". A `useRef(false)` flag looks equivalent and is not: StrictMode
  // double-invokes mount effects in `next dev` and the ref survives between
  // the two passes, so the second pass reads the flag the first one set and
  // focuses the field on load — the exact behaviour this avoids, in the only
  // environment where anyone would notice it. Comparing values is idempotent.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;

    if (step === 'code') boxes.current[0]?.focus();
    else phoneField.current?.focus();
  }, [step]);

  const sendCode = async (phoneNumber: string) => {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await authClient.phoneNumber.sendOtp({ phoneNumber });
      if (response.error) {
        setError(
          messageForStatus(response.error.status, INVALID_PHONE_MESSAGE),
        );
        // A refusal carries how long to wait; honour it. The cooldown case
        // already has a countdown running, but the hourly cap arrives long
        // after it expired — without this the button stays enabled and every
        // press repeats the same message with no hint that the wait is now
        // minutes. Bounded by the window the cap is counted over, so a wrong
        // figure cannot strand the form for longer than the rule itself.
        const { retryAfterSeconds } = response.error as {
          retryAfterSeconds?: unknown;
        };
        if (
          response.error.status === 429 &&
          typeof retryAfterSeconds === 'number' &&
          retryAfterSeconds > 0
        ) {
          setSecondsLeft(
            Math.min(Math.ceil(retryAfterSeconds), OTP_SEND_WINDOW_SECONDS),
          );
        }
        return false;
      }
      setSentTo(phoneNumber);
      setSecondsLeft(RESEND_SECONDS);
      const echoed = otpEchoResponseSchema.safeParse(response.data);
      setDevCode(echoed.success ? echoed.data.devCode : undefined);
      return true;
    } catch {
      setError(MESSAGES.offline);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const submitPhone = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const canonical = normalizeIranPhone(phone);
    if (!canonical) {
      // Rejected without a request: the server would answer the same 400, and
      // spending a round trip to be told what this already knows is slower.
      setError(INVALID_PHONE_MESSAGE);
      return;
    }
    if (await sendCode(canonical)) {
      putCode(emptyCode());
      setStep('code');
    }
  };

  const verify = async (value: string) => {
    if (value.length !== OTP_CODE_LENGTH || isBusy) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await authClient.phoneNumber.verify({
        phoneNumber: sentTo,
        code: value,
      });
      if (response.error) {
        setError(messageForStatus(response.error.status, MESSAGES.wrongCode));
        putCode(emptyCode());
        boxes.current[0]?.focus();
        setIsBusy(false);
        return;
      }
      router.push(next);
      // The navbar and every server component read the session, so the tree
      // has to be re-fetched rather than just navigated.
      router.refresh();
      // Deliberately still busy on the way out — no `finally` here. Navigation
      // is not instant and the boxes are still full, so re-enabling the button
      // lets a second click re-submit a code the server has already consumed:
      // the shopper watches a successful login turn into "wrong code" as the
      // page unmounts.
    } catch {
      setError(MESSAGES.offline);
      setIsBusy(false);
    }
  };

  /**
   * Writes a run of digits into the boxes from `index` on, moves focus to
   * where typing should continue, and verifies once every box is filled.
   *
   * `base` is what the run is written onto: the code as it stands for a
   * keystroke, six empty boxes for a paste — a pasted code replaces what was
   * there rather than merging into it.
   */
  const fillFrom = (index: number, raw: string, base: string[]) => {
    const run = digitsOnly(raw).slice(0, OTP_CODE_LENGTH - index);
    if (!run) return;

    const filled = [...base];
    for (const [offset, digit] of [...run].entries()) {
      filled[index + offset] = digit;
    }
    putCode(filled);
    setError(undefined);

    boxes.current[Math.min(index + run.length, OTP_CODE_LENGTH - 1)]?.focus();
    // Only when every box is filled — a shopper who clicks back to fix the
    // third digit must not trigger a verification against five digits and a gap.
    if (!filled.includes('')) void verify(filled.join(''));
  };

  /**
   * One box's `change`. Usually one character, but **not always**: an OTP
   * autofill — the iOS/Android "from Messages" suggestion, a password manager
   * — hands the whole code to a single box as a change event, never a paste,
   * and `maxLength` does not apply to a programmatic fill. Taking one digit of
   * the six there would drop five of them on the exact platform SMS codes
   * exist for, so a run is the general case and a keystroke is the short one.
   */
  const putDigit = (index: number, raw: string) =>
    fillFrom(index, raw, entered.current);

  const onBoxKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (event.key !== 'Backspace') return;
    event.preventDefault();

    // An empty box sends the cursor back a place and clears that one instead,
    // which is what every code input does and what the thumb expects.
    const target = entered.current[index] ? index : Math.max(0, index - 1);
    const cleared = [...entered.current];
    cleared[target] = '';
    putCode(cleared);
    setError(undefined);
    boxes.current[target]?.focus();
  };

  /**
   * A whole code arriving at once. Always fills from the first box, whichever
   * box it was dropped on: someone pasting six digits means them as the code,
   * not as a suffix starting wherever the caret happened to be.
   */
  const onPaste = (event: React.ClipboardEvent) => {
    const pasted = event.clipboardData.getData('text');
    if (!digitsOnly(pasted)) return;
    event.preventDefault();

    fillFrom(0, pasted, emptyCode());
  };

  const resend = async () => {
    if (secondsLeft > 0) return;
    putCode(emptyCode());
    if (await sendCode(sentTo)) {
      // A successful resend swaps the button the shopper just pressed for the
      // countdown, so focus would land on `<body>` — the same drop the step
      // effect exists to prevent, one control down. The boxes they now have to
      // fill are where it belongs.
      boxes.current[0]?.focus();
    }
  };

  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <main className="bg-secondary/20 flex min-h-screen items-start justify-center pt-20">
      <div className="w-full max-w-md px-4 py-12 sm:px-8">
        <a
          href={PATHS.HOME}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mb-8 flex items-center gap-2 rounded text-sm focus-visible:ring-2 focus-visible:outline-none"
          data-umami-event="login-back-to-shop"
        >
          <ChevronRight size={14} aria-hidden="true" /> بازگشت به فروشگاه
        </a>

        <div className="bg-card border-border rounded-3xl border p-7 shadow-sm">
          <div className="bg-accent/10 text-accent-strong mb-5 flex size-14 items-center justify-center rounded-2xl">
            {step === 'phone' ? (
              <Phone size={22} aria-hidden="true" />
            ) : (
              <MessageSquare size={22} aria-hidden="true" />
            )}
          </div>

          {step === 'phone' ? (
            <>
              <h1 className="mb-2 text-2xl font-black">ورود به اسموکی</h1>
              <p className="text-muted-foreground mb-7 text-sm">
                شماره موبایلت را وارد کن؛ یک کد شش‌رقمی برایت پیامک می‌کنیم.
              </p>

              <form onSubmit={submitPhone} noValidate>
                <label
                  htmlFor={fieldId}
                  className="mb-1.5 block text-sm font-medium"
                >
                  شماره موبایل
                </label>
                <input
                  id={fieldId}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  dir="ltr"
                  placeholder="0912 123 4567"
                  ref={phoneField}
                  value={phone}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : hintId}
                  data-umami-event="login-phone-type"
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setError(undefined);
                  }}
                  className={cn(
                    'bg-secondary focus-visible:ring-ring w-full rounded-xl border px-4 py-3 text-start tracking-widest transition-colors outline-none focus-visible:ring-2',
                    error
                      ? 'border-destructive bg-destructive-soft/40'
                      : 'border-border focus-visible:border-accent-strong',
                  )}
                />
                {error ? (
                  <p
                    id={errorId}
                    role="alert"
                    className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
                  >
                    <AlertCircle
                      size={12}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                    {error}
                  </p>
                ) : (
                  <p
                    id={hintId}
                    className="text-muted-foreground mt-1.5 text-xs"
                  >
                    بدون کد کشور، مثل {toPersianDigits(CANONICAL_PHONE_EXAMPLE)}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isBusy}
                  className="bg-brand hover:bg-brand-hover focus-visible:ring-brand-foreground disabled:bg-muted disabled:text-muted-foreground text-brand-foreground mt-6 w-full rounded-xl py-3.5 font-bold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  data-umami-event="login-request-code"
                >
                  {isBusy ? 'در حال ارسال…' : 'دریافت کد تایید'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-2xl font-black">کد تایید را وارد کن</h1>
              <p className="text-muted-foreground mb-7 text-sm">
                کد شش‌رقمی به شماره{' '}
                <span dir="ltr" className="font-medium">
                  {toPersianDigits(toLocalIranPhone(sentTo))}
                </span>{' '}
                پیامک شد.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setError(undefined);
                    putCode(emptyCode());
                    setDevCode(undefined);
                  }}
                  className="text-accent-strong focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  data-umami-event="login-edit-phone"
                >
                  ویرایش شماره
                </button>
              </p>

              {/* Staging/local only — the code was never texted anywhere, so
                  the page is the only place it can be read. ASCII digits and
                  ltr for the same reason the SMS uses them: it gets typed back
                  into the boxes verbatim. */}
              {devCode ? (
                <p className="border-accent-strong/40 bg-accent/10 text-accent-strong mb-4 rounded-xl border border-dashed px-3 py-2 text-center text-sm">
                  حالت آزمایشی — کد ورود:{' '}
                  <span
                    dir="ltr"
                    className="font-mono font-bold tracking-widest"
                  >
                    {devCode}
                  </span>
                </p>
              ) : null}

              {/* The code reads left to right even on an RTL page: it is a
                  number, and the first digit typed must be the leftmost box. */}
              <div dir="ltr" className="mb-2 flex justify-center gap-2">
                {Array.from({ length: OTP_CODE_LENGTH }, (_, index) => (
                  <input
                    key={index}
                    ref={(element) => {
                      boxes.current[index] = element;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={digits[index] ?? ''}
                    aria-label={`رقم ${formatNumber(index + 1)} از کد تایید`}
                    aria-invalid={Boolean(error)}
                    // Without this the boxes announce "invalid" six times and
                    // never say why: `role="alert"` speaks once, on insertion,
                    // and a shopper tabbing back through afterwards has no way
                    // to reach the reason.
                    aria-describedby={error ? errorId : undefined}
                    // One shared event name, not six: the useful signal is
                    // "someone started entering a code", and six numbered
                    // events would only split that number into noise.
                    data-umami-event="login-code-type"
                    onChange={(event) => putDigit(index, event.target.value)}
                    onKeyDown={(event) => onBoxKeyDown(index, event)}
                    onPaste={onPaste}
                    className={cn(
                      'bg-secondary focus-visible:ring-ring h-13 w-11 rounded-xl border text-center text-lg outline-none focus-visible:ring-2',
                      error
                        ? 'border-destructive bg-destructive-soft/40'
                        : 'border-border focus-visible:border-accent-strong',
                    )}
                  />
                ))}
              </div>

              {error ? (
                <p
                  id={errorId}
                  role="alert"
                  className="text-destructive mt-3 flex items-center justify-center gap-1 text-xs"
                >
                  <AlertCircle size={12} aria-hidden="true" /> {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => verify(code)}
                disabled={!isComplete || isBusy}
                className="bg-brand hover:bg-brand-hover focus-visible:ring-brand-foreground disabled:bg-muted disabled:text-muted-foreground text-brand-foreground mt-6 w-full rounded-xl py-3.5 font-bold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed"
                data-umami-event="login-verify-code"
              >
                {isBusy ? 'در حال بررسی…' : 'تایید و ورود'}
              </button>

              <div className="mt-5 text-center text-sm">
                {secondsLeft > 0 ? (
                  <p className="text-muted-foreground flex items-center justify-center gap-1.5">
                    <Clock size={14} aria-hidden="true" />
                    ارسال دوباره کد تا{' '}
                    <span className="font-medium">
                      {formatCountdown(secondsLeft)}
                    </span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={resend}
                    disabled={isBusy}
                    className="text-accent-strong focus-visible:ring-ring mx-auto flex items-center gap-1.5 rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    data-umami-event="login-resend-code"
                  >
                    <RefreshCw size={14} aria-hidden="true" /> ارسال دوباره کد
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
