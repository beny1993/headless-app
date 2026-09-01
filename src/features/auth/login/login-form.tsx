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
import { normalizeSearchText } from '@/lib/catalog/search-text';
import { PATHS } from '@/lib/constant/paths';
import { formatNumber, toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Digits in a code. Must match `otpLength` in `src/lib/auth/index.ts`. */
const CODE_LENGTH = 6;

/**
 * How long before «ارسال دوباره کد» comes back.
 *
 * Deliberately longer than the server's 90-second cooldown
 * (`OTP_RESEND_COOLDOWN_SECONDS`): a button that appears before the server will
 * accept it is a button that reliably fails. Erring the other way costs half a
 * minute of waiting and nothing else.
 */
const RESEND_SECONDS = 120;

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
  return status ? fallback : MESSAGES.offline;
};

type Step = 'phone' | 'code';

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
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // One `setTimeout` a second, not an interval: it restarts cleanly whenever a
  // resend puts a new number on the clock, and it is the only timer this
  // component owns, so its tests can fake exactly that.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const sendCode = async (phoneNumber: string) => {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await authClient.phoneNumber.sendOtp({ phoneNumber });
      if (response.error) {
        setError(
          messageForStatus(response.error.status, INVALID_PHONE_MESSAGE),
        );
        return false;
      }
      setSentTo(phoneNumber);
      setSecondsLeft(RESEND_SECONDS);
      return true;
    } catch {
      setError(MESSAGES.offline);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const submitPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    const canonical = normalizeIranPhone(phone);
    if (!canonical) {
      // Rejected without a request: the server would answer the same 400, and
      // spending a round trip to be told what this already knows is slower.
      setError(INVALID_PHONE_MESSAGE);
      return;
    }
    if (await sendCode(canonical)) {
      setCode('');
      setStep('code');
    }
  };

  const verify = async (value: string) => {
    if (value.length !== CODE_LENGTH || isBusy) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await authClient.phoneNumber.verify({
        phoneNumber: sentTo,
        code: value,
      });
      if (response.error) {
        setError(messageForStatus(response.error.status, MESSAGES.wrongCode));
        setCode('');
        boxes.current[0]?.focus();
        return;
      }
      router.push(next);
      // The navbar and every server component read the session, so the tree
      // has to be re-fetched rather than just navigated.
      router.refresh();
    } catch {
      setError(MESSAGES.offline);
    } finally {
      setIsBusy(false);
    }
  };

  /** Writes one digit into position `index` and moves on. */
  const putDigit = (index: number, raw: string) => {
    const digit = digitsOnly(raw).slice(-1);
    if (!digit) return;

    const next = code.padEnd(CODE_LENGTH, ' ').split('');
    next[index] = digit;
    const updated = next.join('').trimEnd();
    setCode(updated);
    setError(undefined);

    if (index < CODE_LENGTH - 1) boxes.current[index + 1]?.focus();
    if (updated.length === CODE_LENGTH) void verify(updated);
  };

  const onBoxKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (event.key === 'Backspace' && !code[index]) {
      event.preventDefault();
      const previous = Math.max(0, index - 1);
      setCode(code.slice(0, previous));
      boxes.current[previous]?.focus();
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      setCode(code.slice(0, index));
      setError(undefined);
    }
  };

  /** A whole code arriving at once — pasted, or filled from the SMS. */
  const onPaste = (event: React.ClipboardEvent) => {
    const pasted = digitsOnly(event.clipboardData.getData('text')).slice(
      0,
      CODE_LENGTH,
    );
    if (!pasted) return;
    event.preventDefault();
    setCode(pasted);
    setError(undefined);
    boxes.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
    if (pasted.length === CODE_LENGTH) void verify(pasted);
  };

  const resend = async () => {
    if (secondsLeft > 0) return;
    setCode('');
    await sendCode(sentTo);
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
                  value={phone}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : hintId}
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
                  className="bg-accent-strong hover:bg-accent-hover focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground mt-6 w-full rounded-xl py-3.5 font-bold text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
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
                    setCode('');
                  }}
                  className="text-accent-strong focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  data-umami-event="login-edit-phone"
                >
                  ویرایش شماره
                </button>
              </p>

              {/* The code reads left to right even on an RTL page: it is a
                  number, and the first digit typed must be the leftmost box. */}
              <div dir="ltr" className="mb-2 flex justify-center gap-2">
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  <input
                    key={index}
                    ref={(element) => {
                      boxes.current[index] = element;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={code[index] ?? ''}
                    aria-label={`رقم ${formatNumber(index + 1)} از کد تایید`}
                    aria-invalid={Boolean(error)}
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
                  role="alert"
                  className="text-destructive mt-3 flex items-center justify-center gap-1 text-xs"
                >
                  <AlertCircle size={12} aria-hidden="true" /> {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => verify(code)}
                disabled={code.length < CODE_LENGTH || isBusy}
                className="bg-accent-strong hover:bg-accent-hover focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground mt-6 w-full rounded-xl py-3.5 font-bold text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed"
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
