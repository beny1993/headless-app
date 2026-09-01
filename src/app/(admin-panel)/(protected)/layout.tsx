import Link from 'next/link';
import { DEFAULT_SITE_NAME } from '@/constants';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireAdmin } from '@/lib/auth/session';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { SignOutButton } from '@/features/auth/sign-out-button';

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            href={PROTECTED_PATHS.INDEX}
            className="text-sm font-semibold"
            data-umami-event="admin-panel-header-home"
          >
            {DEFAULT_SITE_NAME} · Admin panel
          </Link>
          <div className="flex items-center gap-4">
            {/* The phone number, not the derived `…@phone.smokey.invalid`
                address, which is a placeholder nobody would recognize. */}
            <span className="text-muted-foreground text-sm" dir="ltr">
              {toLocalIranPhone(session.user.phoneNumber ?? '')}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
