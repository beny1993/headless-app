import { describe, expect, it } from 'vitest';
import { pgErrorOf } from './pg-error';

describe('pgErrorOf', () => {
  it('reads a raw pg error', () => {
    expect(
      pgErrorOf({ code: '23505', constraint: 'categories_slug_unique' }),
    ).toEqual({ code: '23505', constraint: 'categories_slug_unique' });
  });

  it('reads a pg error that drizzle wrapped at `.cause`', () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: { code: '23503' },
    });
    expect(pgErrorOf(wrapped)?.code).toBe('23503');
  });

  it.each([null, undefined, 'boom', new Error('no code'), { code: 23505 }])(
    'returns null for %j',
    (error) => {
      expect(pgErrorOf(error)).toBeNull();
    },
  );
});
