import * as Sentry from '@sentry/nextjs';

const warned = new Set<string>();

/**
 * Logs `message` and reports it to Sentry the first time `key` is seen in this
 * process. The message goes to Sentry verbatim: never put a code, a phone
 * number or a secret in it.
 */
export const warnOnce = (key: string, message: string): void => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
  Sentry.captureMessage(message, 'warning');
};
