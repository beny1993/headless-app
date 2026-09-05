import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireAdmin } from '@/lib/auth/session';
import { AdminSidebar } from '@/features/admin-panel/shell/admin-sidebar';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { toPersianDigits } from '@/lib/format';

// The admin shell — the sidebar frame every admin page renders inside, ported
// from the Figma admin design. The role gate stays here (a session alone is not
// authorization; customers get sessions too), so no page below re-checks it.
export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAdmin();

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <AdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-border flex shrink-0 items-center justify-between border-b bg-white px-6 py-4">
          <span className="text-muted-foreground text-sm">
            پنل مدیریت اسموکی
          </span>
          <div className="flex items-center gap-4">
            {/* The phone number, not the derived `…@phone.smokey.invalid`
                address, which identifies nobody. LTR so the digits and + don't
                bidi-reorder inside the RTL shell. */}
            <span className="text-muted-foreground text-sm" dir="ltr">
              {toPersianDigits(
                toLocalIranPhone(session.user.phoneNumber ?? ''),
              )}
            </span>
            <SignOutButton page="admin-panel" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
