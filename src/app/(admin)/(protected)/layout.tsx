import Link from 'next/link';
import { DEFAULT_SITE_NAME } from '@/constants';
import { requireSession } from '@auth/session';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { SignOutButton } from '@/features/auth/sign-out-button';

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            href={PROTECTED_PATHS.INDEX}
            className="text-sm font-semibold"
            data-umami-event="backoffice-header-home"
          >
            {DEFAULT_SITE_NAME} · Back office
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground text-sm">
              {session.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
