// Pins the root layout's analytics mount, the half of the tracked-link fix no
// other gate can see: the e2e run blanks the Umami vars and build:local never
// sets them. Without this, the layout could go back to Umami's own bare
// `<Script>` (auto-track on, so every tracked link is a full page load again),
// or lose the `<Suspense>` a static page's build needs, and every gate would
// still pass.
//
// src/lib/utils/env.ts captures NEXT_PUBLIC_* once, when it loads
// (STATIC_INLINED_VARS), so each case stubs the vars and imports the layout
// fresh — and takes UmamiTracker and next/script from that same fresh import,
// since a reset module registry hands out new component identities.
import {
  Suspense,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The module edges the layout's own logic does not need: a next/font call that
// only Next's compiler can run, and a stylesheet Vite would hand to PostCSS.
vi.mock('@/lib/fonts', () => ({ vazirmatn: { variable: 'font-vazirmatn' } }));
vi.mock('./globals.css', () => ({}));

const SCRIPT_URL = 'https://analytics.test/script.js';
const WEBSITE_ID = '00000000-0000-4000-8000-000000000000';

type Element = ReactElement<{ children?: ReactNode }>;

/** Every element in a tree the layout returned, without rendering components. */
function* elements(node: ReactNode): Generator<Element> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
    return;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  yield node;
  yield* elements(node.props.children);
}

/** The root layout's tree with these Umami vars, and the types to find in it. */
async function layoutWith(scriptUrl: string, websiteId: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_UMAMI_SCRIPT_URL', scriptUrl);
  vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', websiteId);
  const { default: RootLayout } = await import('./layout');
  const { UmamiTracker } = await import('@/components/umami-tracker');
  const { default: Script } = await import('next/script');
  return {
    all: [...elements(RootLayout({ children: 'page' }))],
    UmamiTracker,
    Script,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the root layout', () => {
  it('mounts the tracker inside Suspense, with the vars it was built with', async () => {
    const { all, UmamiTracker, Script } = await layoutWith(
      ` ${SCRIPT_URL} `,
      ` ${WEBSITE_ID} `,
    );

    const boundaries = all.filter((element) => element.type === Suspense);
    expect(boundaries).toHaveLength(1);
    const inside = [...elements(boundaries[0].props.children)];
    const trackers = inside.filter((element) => element.type === UmamiTracker);
    expect(trackers).toHaveLength(1);
    // Trimmed: a padded value from the deploy's env would otherwise reach the
    // script's src.
    expect(trackers[0].props).toEqual({
      src: SCRIPT_URL,
      websiteId: WEBSITE_ID,
    });
    // Umami's own script, mounted bare, would switch auto-track back on.
    expect(all.some((element) => element.type === Script)).toBe(false);
  });

  it.each([
    ['script URL', '', WEBSITE_ID],
    ['website id', SCRIPT_URL, ''],
    ['script URL (whitespace)', '  ', WEBSITE_ID],
    ['website id (whitespace)', SCRIPT_URL, '  '],
  ])('mounts no tracker without a %s', async (_, scriptUrl, websiteId) => {
    const { all, UmamiTracker, Script } = await layoutWith(
      scriptUrl,
      websiteId,
    );

    expect(
      all.filter(
        (element) =>
          element.type === UmamiTracker ||
          element.type === Script ||
          element.type === Suspense,
      ),
    ).toEqual([]);
  });
});
