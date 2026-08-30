import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiError,
  apiSuccess,
  formatZodIssues,
  unwrap,
  unwrapOr,
  type ApiResponse,
} from './envelope';

describe('envelope', () => {
  it('builds a success envelope', () => {
    const data = { id: faker.string.uuid() };
    expect(apiSuccess(data)).toEqual({ status: 'success', data });
  });

  it('builds an error envelope and omits empty errors', () => {
    expect(apiError('nope')).toEqual({ status: 'error', message: 'nope' });
    expect(apiError('nope', [])).toEqual({ status: 'error', message: 'nope' });
    expect(apiError('nope', ['a'])).toEqual({
      status: 'error',
      message: 'nope',
      errors: ['a'],
    });
  });

  it('unwrap returns data on success', () => {
    expect(unwrap(apiSuccess(42))).toBe(42);
  });

  it('unwrap throws the message on error', () => {
    expect(() => unwrap(apiError('boom') as ApiResponse<number>)).toThrow(
      'boom',
    );
  });

  it('unwrap throws on a malformed body', () => {
    expect(() => unwrap({} as ApiResponse<number>)).toThrow(
      'Malformed API response',
    );
  });

  it('unwrapOr falls back on error', () => {
    expect(unwrapOr(apiError('boom') as ApiResponse<number>, 7)).toBe(7);
    expect(unwrapOr(apiSuccess(1), 7)).toBe(1);
  });

  it('formatZodIssues flattens issues to "path: message"', () => {
    const schema = z.object({ email: z.email() });
    const result = schema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const [issue] = formatZodIssues(result.error);
      expect(issue).toMatch(/^email: /);
    }
  });
});
