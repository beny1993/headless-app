// Migration 0018 blanks the phone-number names the old OTP sign-up stored. It
// rewrites customer rows on production, so it runs here against a throwaway
// copy of `user` (the pattern of src/db/seed/shipping-migration.integration.test.ts):
// `search_path` points the migration's unqualified `"user"` at the copy, inside a
// transaction that is always rolled back, so no real account is read or changed.
//
// It lives beside the sign-up code, not in src/db/migrations/: that folder is
// copied whole into the production image.
import { readFileSync } from 'node:fs';
import { TransactionRollbackError, asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@/db';
import { users } from '@/db/schema/auth';
import { databaseReachable, testDb } from '@/db/test-db';

const MIGRATION = readFileSync(
  'src/db/migrations/0018_blank_phone_names.sql',
  'utf8',
);

describe.skipIf(!databaseReachable)(
  'migration 0018 — blank phone names',
  () => {
    const inScratchSchema = async (run: (tx: Tx) => Promise<void>) => {
      try {
        await testDb.transaction(async (tx) => {
          await tx.execute(sql.raw('CREATE SCHEMA migration_0018_probe'));
          await tx.execute(
            sql.raw(
              'CREATE TABLE migration_0018_probe."user" (LIKE public."user" INCLUDING ALL)',
            ),
          );
          await tx.execute(
            sql.raw('SET LOCAL search_path TO migration_0018_probe'),
          );
          await run(tx);
          tx.rollback();
        });
      } catch (error) {
        if (!(error instanceof TransactionRollbackError)) throw error;
      }
    };

    const account = (id: string, name: string, phoneNumber: string | null) => ({
      id,
      name,
      email: `${id}@phone.smokey.invalid`,
      phoneNumber,
    });

    it('blanks only a name that is the account’s own number', async () => {
      await inScratchSchema(async (tx) => {
        await tx.insert(users).values([
          account('a-phone-name', '09121234567', '+989121234567'),
          account('b-real-name', 'سارا محمدی', '+989121234568'),
          // Someone else's number is still a name this account was given.
          account('c-other-number', '09121234567', '+989121234569'),
          account('d-no-phone', '09121234570', null),
        ]);

        await tx.execute(sql.raw(MIGRATION));

        const rows = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .orderBy(asc(users.id));
        expect(rows).toEqual([
          { id: 'a-phone-name', name: '' },
          { id: 'b-real-name', name: 'سارا محمدی' },
          { id: 'c-other-number', name: '09121234567' },
          { id: 'd-no-phone', name: '09121234570' },
        ]);
      });
    });
  },
);
