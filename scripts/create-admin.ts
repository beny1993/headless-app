/**
 * Provision a back-office user (sign-in is invite-only).
 *
 *   pnpm create-admin you@example.com [Display Name]
 *
 * Requires the database to be up (`docker compose --file docker-compose-dev.yaml up -d`)
 * and migrations applied (`pnpm migration:migrate`).
 */
import 'dotenv/config';
import { UserDao } from '@/db/dao/UserDao';
import { ROLES } from '@/db/schema/auth';

const [email, ...nameParts] = process.argv.slice(2);

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm create-admin <email> [name]');
  process.exit(1);
}

const name = nameParts.join(' ') || email.split('@')[0];

const existing = await UserDao.findByEmail(email);
if (existing) {
  console.log(`User ${existing.email} already exists (role: ${existing.role})`);
  process.exit(0);
}

// `role` is explicit: the DAO and the DB column both default to customer.
const user = await UserDao.create({ email, name, role: ROLES.ADMIN });
console.log(`Created admin user ${user.email} (${user.id})`);
process.exit(0);
