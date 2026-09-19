// The `/api/*` rate limiter, proven against the running server rather than a
// mounted Hono instance: that it actually covers a PUBLIC route (the mount
// position is the defect this story exists to avoid), that the one
// browser-redirect route answers a redirect instead of JSON, and that the
// probe Coolify polls is never counted.
//
// Every request here carries a synthetic `CF-Connecting-IP`, so the spec spends
// its OWN bucket. `playwright.config.ts` turns APP_CONFIG_TRUST_CF_HEADER on for
// exactly this reason — without it the header is ignored, this spec's flood
// lands in the bucket shared by the whole run, and it would throttle the other
// specs instead of itself. `page.request` is invisible to the `test` fixture's
// failed-request watch, so no opt-out is needed for the 429s.
import { API_PATHS, checkoutFailurePath } from '../src/lib/constant/paths';

import { expect, test } from './support';

/** A distinct address per test, so no two tests share a budget. */
const ip = (tag: string) => `198.51.100.${tag}`;

test.describe('API rate limiting', () => {
  test('throttles the public catalogue and says so in Persian', async ({
    page,
  }) => {
    const headers = { 'cf-connecting-ip': ip('11') };
    let throttled: { status: number; body: string } | null = null;

    // Well past the catalogue budget. The first over-budget answer ends it.
    for (let i = 0; i < 200; i++) {
      const res = await page.request.get(API_PATHS.PRODUCTS, { headers });
      if (res.status() === 429) {
        throttled = { status: res.status(), body: await res.text() };
        break;
      }
    }

    // If this is null the limiter is not covering a public route at all —
    // which is exactly what mounting it after the routes would produce, with
    // every unit test still green.
    expect(throttled).not.toBeNull();
    expect(throttled!.status).toBe(429);
    expect(throttled!.body).toContain('تعداد درخواست‌ها');
  });

  test('answers the payment callback with a redirect, never JSON', async ({
    page,
  }) => {
    // Zarinpal sends the shopper's own browser here, so a JSON body would
    // render as raw text in their window right after they paid.
    const headers = { 'cf-connecting-ip': ip('12') };
    let redirect: { status: number; location: string | null } | null = null;

    for (let i = 0; i < 120; i++) {
      const res = await page.request.get(
        `${API_PATHS.PAYMENT_CALLBACK}?Authority=e2e-bogus&Status=NOK`,
        { headers, maxRedirects: 0 },
      );
      if (res.status() === 302) {
        redirect = { status: res.status(), location: res.headers().location };
        break;
      }
    }

    expect(redirect).not.toBeNull();
    expect(redirect!.location).toBe(checkoutFailurePath());
  });

  test('never throttles the readiness probe', async ({ page }) => {
    // A counted probe marks the container unhealthy and rolls the deploy back.
    const headers = { 'cf-connecting-ip': ip('13') };

    for (let i = 0; i < 200; i++) {
      const res = await page.request.get(API_PATHS.READY, { headers });
      expect(res.status()).toBe(200);
    }
  });

  test('one caller being throttled does not affect another', async ({
    page,
  }) => {
    const spender = { 'cf-connecting-ip': ip('14') };
    const bystander = { 'cf-connecting-ip': ip('15') };

    for (let i = 0; i < 200; i++) {
      const res = await page.request.get(API_PATHS.PRODUCTS, {
        headers: spender,
      });
      if (res.status() === 429) break;
    }

    const other = await page.request.get(API_PATHS.PRODUCTS, {
      headers: bystander,
    });
    expect(other.status()).toBe(200);
  });
});
