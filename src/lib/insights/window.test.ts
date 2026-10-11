import { describe, expect, it } from 'vitest';
import { DEFAULT_INSIGHT_WINDOW, insightWindowSchema } from './window';

describe('insightWindowSchema', () => {
  it.each([
    ['7', 7],
    ['30', 30],
    ['90', 90],
  ])('reads %s as a %d-day window', (raw, days) => {
    expect(insightWindowSchema.parse(raw)).toBe(days);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a number', 'abc'],
    ['an unoffered window', '31'],
    ['a fraction', '7.5'],
    ['zero', '0'],
    ['negative', '-7'],
    ['huge', '1e20'],
    ['Persian digits', '۷'],
    ['a repeated param', ['7', '30']],
  ])('degrades %s to the default', (_label, raw) => {
    expect(insightWindowSchema.parse(raw)).toBe(DEFAULT_INSIGHT_WINDOW);
  });
});
