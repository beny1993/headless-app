import { SITE_FULL_NAME } from '@/constants';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { requireAdmin } from '@/lib/auth/session';
import { AdminSidebar } from '@/features/admin-panel/shell/admin-sidebar';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { toPersianDigits } from '@/lib/format';

// The admin shell — the sidebar frame every admin page renders inside, ported
// from the Figma admin design. This role check protects the shell; each page
// also checks before reading data because route segments render independently.
export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAdmin();

  return (
    // `relative`, so this clips absolutely positioned content too: the tables'
    // `sr-only` text otherwise sits against the page, beyond every clip, and at
    // a phone's width pans the whole admin sideways.
    // `overflow-clip`, never `overflow-hidden`: a hidden box is still a scroll
    // container. The image pickers' `sr-only` file inputs sit at their
    // unscrolled place — below the frame once `main` has scrolled — and
    // focusing one scrolled this whole frame up over a blank band. A clipped
    // box clips the same and cannot scroll at all.
    <div className="bg-background relative flex h-screen overflow-clip">
      <AdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* `ps-16` below `lg` leaves room for the sidebar's fixed mobile
            hamburger (which lives in this gutter); `lg:ps-6` once the rail
            takes over and the hamburger is hidden. */}
        <header className="border-border flex shrink-0 items-center justify-between border-b bg-white py-4 ps-16 pe-6 lg:ps-6">
          <span className="text-muted-foreground text-sm">
            پنل مدیریت {SITE_FULL_NAME}
          </span>
          <div className="flex items-center gap-4">
            {/* The phone number, not the derived `…@phone.invalid`
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
