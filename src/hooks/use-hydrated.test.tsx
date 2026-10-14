// Pins `useHydrated`: false on the server and in the hydrating render, so the
// two agree and React keeps the server's DOM; true from the render right after;
// and true from the very first render of anything mounted on the client later
// (a client-side navigation), which must never start out disabled.
//
// Read through a probe that prints the value, so a hydrating render that does
// not reproduce the server's would be a text mismatch, which React reports to
// `onRecoverableError`.
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHydrated } from './use-hydrated';

// `hydrateRoot` inside `act()` needs this; RTL sets it for us elsewhere, but
// this file drives React's client API directly. React does not declare the flag
// on `globalThis`, hence the cast.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** What each render of the probe read. */
let renders: boolean[];

function Probe() {
  const hydrated = useHydrated();
  renders.push(hydrated);
  return <p>{hydrated ? 'hydrated' : 'server'}</p>;
}

let container: HTMLDivElement;
let unmount: () => void = () => undefined;

beforeEach(() => {
  renders = [];
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => unmount());
  unmount = () => undefined;
  container.remove();
});

describe('useHydrated', () => {
  it('is false on the server', () => {
    expect(renderToString(<Probe />)).toContain('server');
  });

  it('reproduces the server in the hydrating render, then turns true', () => {
    container.innerHTML = renderToString(<Probe />);
    renders = [];

    const recovered: unknown[] = [];
    act(() => {
      const root = hydrateRoot(container, <Probe />, {
        onRecoverableError: (error) => recovered.push(error),
      });
      unmount = () => root.unmount();
    });

    expect(recovered).toEqual([]);
    expect(renders).toEqual([false, true]);
    expect(container.textContent).toBe('hydrated');
  });

  it('is true from the first render of what mounts after hydration', () => {
    act(() => {
      const root = createRoot(container);
      root.render(<Probe />);
      unmount = () => root.unmount();
    });

    expect(renders).toEqual([true]);
  });
});
