'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  instagramUrl,
  telegramUrl,
  type ContentValue,
} from '@/lib/content/site-content';
import { toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';

export type CardToCardContent = ContentValue<'checkout.payment'>;

/**
 * `6037997512345678` → `۶۰۳۷ ۹۹۷۵ ۱۲۳۴ ۵۶۷۸`. Display only: the page rule is that
 * no ASCII digit renders, so the copy button is what carries the raw number.
 */
export const formatCardNumber = (number: string) =>
  toPersianDigits(number.replace(/(\d{4})(?=\d)/g, '$1 '));

const social = (href: string) =>
  ({ href, target: '_blank', rel: 'noopener noreferrer' }) as const;

/**
 * The card-to-card instructions a shopper sees wherever the payment method is
 * chosen or shown again (checkout, the result page, an order in the account):
 * the admin's note, the filled card slots (an empty slot is simply absent) with a
 * copy button each, and the contact sentence — always there, with «اینستاگرام»
 * and «تلگرام» in it linking to the shop's accounts while their handles are set
 * (plain words otherwise). It asks for coordination only: the receipt itself is
 * attached in the app — at checkout, under this panel, before «ثبت سفارش», or
 * on the order's page. A client component only for the copy button; server
 * pages render it with the block they read.
 */
export function CardToCardPanel({
  payment,
  className,
}: {
  payment: CardToCardContent;
  className?: string;
}) {
  const cards = payment.bankCards.filter((card) => card.number !== '');

  return (
    <div
      className={cn(
        'bg-warning-soft border-warning/30 rounded-2xl border p-5 text-start',
        className,
      )}
    >
      <p className="text-sm leading-relaxed">{payment.note}</p>

      {cards.length > 0 && (
        <ul className="mt-4 space-y-3">
          {cards.map((card) => (
            <li
              key={card.number}
              className="bg-card border-border rounded-xl border p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  dir="ltr"
                  className="nums text-lg font-bold tracking-wider"
                >
                  {formatCardNumber(card.number)}
                </span>
                <CopyButton value={card.number} />
              </div>
              {(card.bank !== '' || card.holder !== '') && (
                <p className="text-muted-foreground mt-1.5 text-xs">
                  {[card.bank, card.holder].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-sm leading-relaxed">
        برای هماهنگی، از طریق{' '}
        <ContactLink
          handle={payment.instagram}
          url={instagramUrl}
          event="checkout-card-instagram"
        >
          اینستاگرام
        </ContactLink>{' '}
        یا{' '}
        <ContactLink
          handle={payment.telegram}
          url={telegramUrl}
          event="checkout-card-telegram"
        >
          تلگرام
        </ContactLink>{' '}
        با ما در تماس باش.
      </p>
    </div>
  );
}

/** A platform name inside the contact sentence: a link to the shop's account
 *  while its handle is set, the plain word otherwise, so the sentence reads the
 *  same either way. */
function ContactLink({
  handle,
  url,
  event,
  children,
}: {
  handle: string;
  url: (handle: string) => string;
  event: string;
  children: string;
}) {
  if (handle === '') return children;
  return (
    <a
      {...social(url(handle))}
      className="text-accent-strong font-medium underline"
      data-umami-event={event}
    >
      {children}
    </a>
  );
}

/** Puts the raw sixteen digits on the clipboard; a blocked clipboard just leaves
 *  the number on screen to select. The "copied" state resets after two seconds. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context, permission denied): no-op.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="کپی شماره کارت"
      className="bg-secondary hover:bg-secondary/70 inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      data-umami-event="checkout-card-copy"
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      {copied ? 'کپی شد' : 'کپی'}
    </button>
  );
}
