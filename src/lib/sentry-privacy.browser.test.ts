// The browser half of `sentry-privacy.test.ts`: the SDK's browser build (vitest
// aliases `@sentry/nextjs` to it), the real `sentryOptions()` and the default
// browser integrations, in happy-dom, sending to a local transport.
import * as Sentry from '@sentry/nextjs';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { sentryOptions } from './sentry';

const PHONE = '09121234567';
const NAME = 'علی رضایی';

let captured: string | undefined;
// Silenced before `init`, so the SDK wraps the silent one: a console call
// still reaches its breadcrumb handler, and prints nothing into the run.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(() => {
  Sentry.init({
    ...sentryOptions(),
    dsn: 'https://public@example.invalid/1',
    // A local transport: no events leave this process. Sessions travel in
    // envelopes of their own, so only an event's is kept.
    transport: () => ({
      send: async (envelope: unknown) => {
        const [, [[item]]] = envelope as [unknown, [[{ type: string }]]];
        if (item.type === 'event') captured = JSON.stringify(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close(2000);
  consoleError.mockRestore();
});
afterEach(() => {
  Sentry.getIsolationScope().clearBreadcrumbs();
  document.body.replaceChildren();
});

type Breadcrumb = { category?: string; message?: string };
let captures = 0;

/** The envelope of the next error, raw, and the breadcrumbs it carried. */
async function capture() {
  captured = undefined;
  // A new message each time: the browser defaults include Dedupe, which drops
  // an error identical to the one before it.
  Sentry.captureException(new Error(`Render failed ${++captures}`));
  await Sentry.flush(2000);
  expect(captured).toBeDefined();
  const [, [[, event]]] = JSON.parse(captured!) as [
    unknown,
    [[unknown, { breadcrumbs?: Breadcrumb[] }]],
  ];
  return { raw: captured!, breadcrumbs: event.breadcrumbs ?? [] };
}

// The browser SDK writes a clicked or typed-into element's `aria-label`,
// `title` and `alt` into its `ui.*` breadcrumb, and the users list labels each
// row's link «مشاهده کاربر {name} {phone}».
describe('screen-reader text in element breadcrumbs', () => {
  it.each([
    ['aria-label', 'a', 'click', 'row', 'body > a.row[aria-label]'],
    ['title', 'button', 'click', 'row', 'body > button.row[title]'],
    ['alt', 'img', 'click', 'row', 'body > img.row[alt]'],
    ['aria-label', 'input', 'keypress', 'row', 'body > input.row[aria-label]'],
    // A class the receipt-key scrub takes for a key, in either case. That
    // scrub runs after this cut: run first, it would eat the `[aria-label="`
    // the cut looks for, and the label would go out whole.
    ['aria-label', 'a', 'click', 'receipts/x', 'body > a.receipts/[redacted]'],
    [
      'title',
      'button',
      'click',
      'RECEIPTS/x',
      'body > button.RECEIPTS/[redacted]',
    ],
  ])(
    'drops the %s of a %s on %s (class %s), keeping the element',
    async (attribute, tag, type, className, message) => {
      const element = document.createElement(tag);
      element.className = className;
      element.setAttribute(attribute, `مشاهده کاربر ${NAME} ${PHONE}`);
      document.body.append(element);
      element.dispatchEvent(new Event(type, { bubbles: true }));

      const { raw, breadcrumbs } = await capture();

      expect(raw).not.toContain('9121234567');
      expect(raw).not.toContain(NAME);
      expect(breadcrumbs).toContainEqual(
        expect.objectContaining({
          category: type === 'click' ? 'ui.click' : 'ui.input',
          message,
        }),
      );
    },
  );

  it('drops a label whose own text closes the bracket', async () => {
    // The SDK does not escape the value, so matching up to the next `"]`
    // would leave «رضایی 0912…» behind.
    const link = document.createElement('a');
    link.className = 'row';
    link.setAttribute('aria-label', `مشاهده کاربر علی"] > رضایی ${PHONE}`);
    document.body.append(link);
    link.dispatchEvent(new Event('click', { bubbles: true }));

    const { raw, breadcrumbs } = await capture();

    expect(raw).not.toContain('9121234567');
    expect(raw).not.toContain('رضایی');
    expect(breadcrumbs).toContainEqual(
      expect.objectContaining({
        category: 'ui.click',
        message: 'body > a.row[aria-label]',
      }),
    );
  });

  it('leaves an element with no screen-reader text as it is', async () => {
    const button = document.createElement('button');
    button.className = 'save';
    button.setAttribute('type', 'submit');
    document.body.append(button);
    button.dispatchEvent(new Event('click', { bubbles: true }));

    const { breadcrumbs } = await capture();

    expect(breadcrumbs).toContainEqual(
      expect.objectContaining({
        category: 'ui.click',
        message: 'body > button.save[type="submit"]',
      }),
    );
  });
});

// Next logs a failed client navigation's RSC fetch with its full URL, query
// included, and the browser SDK keeps every console call as a breadcrumb.
describe('console breadcrumbs', () => {
  it("drops Next's failed-fetch log and the admin search in it", async () => {
    console.error(
      `Failed to fetch RSC payload for https://shop.example/admin-panel/users?q=${PHONE}. Falling back to browser navigation.`,
      new TypeError('Failed to fetch'),
    );

    const { raw, breadcrumbs } = await capture();

    expect(raw).not.toContain('9121234567');
    expect(breadcrumbs.map((breadcrumb) => breadcrumb.category)).not.toContain(
      'console',
    );
  });
});
