import { afterEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

const { warnOnce } = await import('./warn-once');

afterEach(() => {
  vi.restoreAllMocks();
  captureMessage.mockReset();
});

describe('warnOnce', () => {
  it('logs and reports a message the first time its key is seen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnce('first', 'something is off');
    expect(warn).toHaveBeenCalledWith('something is off');
    expect(captureMessage).toHaveBeenCalledWith('something is off', 'warning');
  });

  it('stays quiet for a key it has already warned about', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnce('repeat', 'once');
    warnOnce('repeat', 'once');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps separate keys separate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnce('a', 'from a');
    warnOnce('b', 'from b');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
