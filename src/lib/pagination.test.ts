import { describe, expect, it } from 'vitest';
import { pageParamSchema, pageWindow } from './pagination';

describe('pageWindow', () => {
  it('is empty when nothing matched', () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('is a single page when everything fits on one', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('lists every page while they fit in the window', () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('centres the window on the current page', () => {
    expect(pageWindow(6, 10)).toEqual([4, 5, 6, 7, 8]);
  });

  it('hugs the start without running off it', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hugs the end without running past it', () => {
    expect(pageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(pageWindow(9, 10)).toEqual([6, 7, 8, 9, 10]);
  });

  it('stays inside the list for a page past the end', () => {
    // `?page=999` reaches here intact; the window must still point at pages
    // that exist so there is a way back.
    expect(pageWindow(999, 3)).toEqual([1, 2, 3]);
  });

  it('stays inside the list for a page below the first', () => {
    expect(pageWindow(0, 3)).toEqual([1, 2, 3]);
  });

  it('honours a caller-chosen window size', () => {
    expect(pageWindow(5, 10, 3)).toEqual([4, 5, 6]);
    expect(pageWindow(5, 10, 1)).toEqual([5]);
  });
});

describe('pageParamSchema', () => {
  it('reads a page number from the URL', () => {
    expect(pageParamSchema.parse('3')).toBe(3);
  });

  it('reads anything else as the first page rather than failing the page', () => {
    // `1e20` is an integer to JavaScript but past MAX_SAFE_INTEGER, which is
    // where zod 4's `.int()` stops: it must never reach Postgres as an OFFSET.
    for (const raw of [
      undefined,
      '',
      'abc',
      '0',
      '-2',
      '1.5',
      '1e20',
      ['2', '3'],
    ]) {
      expect(pageParamSchema.parse(raw), JSON.stringify(raw)).toBe(1);
    }
  });
});
