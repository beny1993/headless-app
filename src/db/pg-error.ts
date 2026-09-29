// Postgres write errors as the admin routes and checkout see them. A constraint
// violation arrives raw from `pg` or wrapped by drizzle at `.cause`, depending on
// the call path; this finds it in either place, so a caller can map a known
// conflict (23505 unique, 23503 foreign key, 23514 check) to a 4xx and rethrow
// the rest as the 500 it is.
export type PgError = { code?: string; constraint?: string };

/** The pg error, whether raw or wrapped by drizzle at `.cause`, else `null`. */
export const pgErrorOf = (error: unknown): PgError | null => {
  for (const candidate of [
    error,
    (error as { cause?: unknown } | null | undefined)?.cause,
  ]) {
    const pg = candidate as PgError | null | undefined;
    if (pg && typeof pg.code === 'string') return pg;
  }
  return null;
};
