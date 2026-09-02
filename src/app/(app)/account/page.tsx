import type { Metadata } from 'next';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireSession } from '@/lib/auth/session';
import { PATHS } from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';

export const metadata: Metadata = { title: 'حساب کاربری' };

/**
 * Still the placeholder — the real page (pet profiles, orders, address book)
 * is [[Story - Account Page and Pet Profiles]].
 *
 * What it gains here is the gate and the one thing a shopper needs to see
 * straight after signing in: that they are signed in, as whom, and how to leave
 * again. The navbar is deliberately untouched — the design's own navbar has no
 * signed-in state, and reading the session there would make every prerendered
 * storefront page dynamic to change an icon nobody looks at.
 */
export default async function Page() {
  const session = await requireSession(PATHS.ACCOUNT);

  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black">حساب کاربری</h1>
      <p className="text-muted-foreground mt-3">
        با شماره{' '}
        <span dir="ltr" className="font-medium">
          {toPersianDigits(toLocalIranPhone(session.user.phoneNumber ?? ''))}
        </span>{' '}
        وارد شده‌ای.
      </p>
      <p className="text-muted-foreground mt-3">
        بقیهٔ حساب کاربری در استوری «Account Page and Pet Profiles» ساخته
        می‌شود.
      </p>
      <div className="mt-8">
        <SignOutButton page="account" />
      </div>
    </main>
  );
}
