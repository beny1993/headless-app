import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conditional classes', () => {
    const includeB: boolean = false;
    expect(cn('a', includeB && 'b', 'c')).toBe('a c');
  });

  it('resolves conflicting tailwind classes to the last one', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
