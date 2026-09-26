// Granting the admin role. Driven by `pnpm create-admin`, and reachable from
// nothing else — there is no API path here and there must not be one: `role` is
// `input: false` everywhere a request can touch it, so the only way to become an
// admin is for somebody with a shell to say so.
import { UserDao } from '@/db/dao/UserDao';
import { ROLES, type User } from '@/db/schema/auth';
import {
  normalizeIranPhone,
  tempEmailForPhone,
  toLocalIranPhone,
} from './phone';

type AdminProvisionResult = {
  outcome: 'created' | 'promoted' | 'already-admin';
  user: User;
};

/**
 * Make the holder of `rawPhone` an admin, creating the account if it does not
 * exist yet.
 *
 * Insert-*or-update*, deliberately: the ordinary path is that someone signs in
 * with their phone like any customer and is promoted afterwards. Refusing an
 * existing account would leave whoever ran this reaching for `UPDATE "user"` in
 * a production console, which is the thing this script exists to avoid.
 *
 * Unlike the HTTP boundary, this normalizes what it is given. A person at a
 * shell types `0912…`; rejecting that would be pedantry, while *storing* it
 * would create a second account beside the one that number already owns.
 */
export async function provisionAdminByPhone(
  rawPhone: string,
  name?: string,
): Promise<AdminProvisionResult> {
  // A plain English Error, not the Persian `INVALID_PHONE_MESSAGE` the login
  // form shows: this surfaces in a terminal, which is the wrong audience for UI
  // copy. Whoever ran the command needs to know what to type instead.
  const phoneNumber = normalizeIranPhone(rawPhone);
  if (phoneNumber === null) {
    throw new Error(
      `Not an Iranian mobile number: "${rawPhone}". Expected something like 09121234567.`,
    );
  }

  const existing = await UserDao.findByPhone(phoneNumber);
  if (existing) {
    if (existing.role === ROLES.ADMIN) {
      return { outcome: 'already-admin', user: existing };
    }
    return {
      outcome: 'promoted',
      user: await UserDao.setRole(existing.id, ROLES.ADMIN),
    };
  }

  const user = await UserDao.create({
    // The same derivation the OTP sign-up uses, so this account and the one a
    // first login would have made are the same account.
    email: tempEmailForPhone(phoneNumber),
    name: name?.trim() || toLocalIranPhone(phoneNumber),
    role: ROLES.ADMIN,
    phoneNumber,
    // The number is trusted because whoever ran this had shell access; making
    // them verify it by SMS first would only add a step, not a check.
    phoneNumberVerified: true,
  });

  return { outcome: 'created', user };
}
