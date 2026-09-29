// How the admin users list and detail show a user's name, phone and role, in
// one place so the two pages cannot drift apart.
import { toLocalIranPhone } from '@/lib/auth/phone';
import { toPersianDigits } from '@/lib/format';
import { Pill } from '@/features/admin-panel/shared/pill';

/** Shown for a blank name: phone sign-ups start with `''`. */
export const NO_NAME = 'بدون نام';

/** The stored name, or null when it is blank. */
export const userName = (name: string): string | null => name.trim() || null;

/** The canonical number in the `09…` form, Persian digits, or null. */
export const userPhone = (phoneNumber: string | null): string | null =>
  phoneNumber ? toPersianDigits(toLocalIranPhone(phoneNumber)) : null;

/**
 * «مدیر» or «مشتری». The page decides which (`role === ROLES.ADMIN`): a value
 * import of the schema is not allowed in a feature component.
 */
export function RolePill({ admin }: { admin: boolean }) {
  return admin ? (
    <Pill tone="accent">مدیر</Pill>
  ) : (
    <Pill tone="muted">مشتری</Pill>
  );
}
