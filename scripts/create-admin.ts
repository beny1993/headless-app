/**
 * Grant the admin role to a phone number.
 *
 *   pnpm create-admin 09121234567 [Display Name]
 *   pnpm create-admin +989121234567
 *
 * Creates the account if that number has none, and promotes it if it does — so
 * the ordinary path is to sign in once through `/login` like any customer and
 * then run this. Safe to re-run.
 *
 * Requires the database to be up (`docker compose --file docker-compose-dev.yaml up -d`)
 * and migrations applied (`pnpm migration:migrate`).
 */
import 'dotenv/config';
import { provisionAdminByPhone } from '@/lib/auth/admin-bootstrap';

const [phone, ...nameParts] = process.argv.slice(2);

if (!phone) {
  console.error('Usage: pnpm create-admin <phone> [name]');
  process.exit(1);
}

try {
  const { outcome, user } = await provisionAdminByPhone(
    phone,
    nameParts.join(' '),
  );

  const said = {
    created: `Created admin ${user.phoneNumber} (${user.id})`,
    promoted: `Promoted ${user.phoneNumber} to admin (${user.id})`,
    'already-admin': `${user.phoneNumber} is already an admin (${user.id})`,
  } as const;
  console.log(said[outcome]);
  process.exit(0);
} catch (error) {
  // Almost always a phone number that is not an Iranian mobile.
  // `provisionAdminByPhone` throws a plain English `Error` for exactly this
  // audience — a terminal, not the login screen — and its message says what to
  // type instead.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
