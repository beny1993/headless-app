// The Zarinpal payment endpoints. Two shapes live here on purpose:
//
//   · JSON/envelope OpenAPI routes — `POST /payments/zarinpal/request` (auth) and
//     `POST /payments/zarinpal/reconcile` (admin) — follow the createRoute +
//     RouteHandler pattern like every other API route.
//   · Browser-redirect / HTML routes — the unauthenticated `GET …/callback` and
//     the dev-only `…/mock-gateway` + `…/mock-complete` — are plain Hono handlers,
//     because a 302 or an HTML page does not fit the JSON envelope. They still
//     validate their inputs with zod (Benyamin's standing rule) and are registered
//     in ../index.ts alongside the OpenAPI routes.
//
// The callback is DELIBERATELY unauthenticated: it is a browser redirect from the
// gateway, and an expired session must never strand a completed payment. It is
// safe because it keys only off the stored authority, verifies with the stored
// amount, and settles through the CAS in src/logic/payments/verify.ts.
import { SITE_FULL_NAME } from '@/constants';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import * as Sentry from '@sentry/nextjs';
import type { Context, Env } from 'hono';
import { z } from 'zod';
import { PaymentDao } from '@/db/dao/PaymentDao';
import {
  API_PATHS,
  checkoutFailurePath,
  checkoutResultPath,
} from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import {
  getZarinpalClient,
  getZarinpalProvider,
  mockLedger,
} from '@/lib/zarinpal/client';
import {
  PaymentRequestError,
  requestZarinpalPayment,
} from '@/logic/payments/request';
import { handleCallback } from '@/logic/payments/verify';
import { reconcilePayments } from '@/logic/payments/reconcile';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';

// ── POST /payments/zarinpal/request (auth) ───────────────────────────────────

const PaymentRequestBodySchema = z
  .object({ orderId: z.uuid() })
  .openapi('PaymentRequestBody');

const PaymentRequestResultSchema = z
  .object({
    /** Where the FE sends the browser to pay (StartPay, or the mock gateway). */
    redirectUrl: z.string(),
  })
  .openapi('PaymentRequestResult');

export const paymentRequestRoute = createRoute({
  method: 'post',
  path: '/payments/zarinpal/request',
  tags: ['payments'],
  summary: 'Start a Zarinpal payment for one of your pending orders',
  request: {
    body: {
      content: { 'application/json': { schema: PaymentRequestBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            PaymentRequestResultSchema,
            'PaymentRequestResponse',
          ),
        },
      },
      description: 'The gateway redirect URL to send the browser to',
    },
    400: errorResponse('Malformed body — orderId is not a uuid'),
    401: errorResponse('No session'),
    404: errorResponse(
      'No such order for this user — the same answer for a missing order and ' +
        'one that belongs to someone else, so ownership never leaks',
    ),
    422: errorResponse(
      'The order exists but cannot start a Zarinpal payment (not ' +
        'pending_payment, or not a Zarinpal order)',
    ),
  },
});

export const paymentRequestHandler: RouteHandler<
  typeof paymentRequestRoute,
  Env & AuthedEnv
> = async (c) => {
  const { orderId } = c.req.valid('json');
  const user = c.get('user');
  try {
    const { redirectUrl } = await requestZarinpalPayment(user.id, orderId);
    return c.json(apiSuccess({ redirectUrl }), 200);
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return c.json(apiError(error.message), error.status);
    }
    throw error;
  }
};

// ── POST /payments/zarinpal/reconcile (admin) ────────────────────────────────

const ReconcileResultSchema = z
  .object({
    verified: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    refundFlagged: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
  })
  .openapi('ReconcileResult');

export const reconcileRoute = createRoute({
  method: 'post',
  path: '/payments/zarinpal/reconcile',
  tags: ['payments'],
  summary: 'Verify stale payments and expire abandoned orders (admin only)',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(ReconcileResultSchema, 'ReconcileResponse'),
        },
      },
      description: 'Counts of what the sweep verified, failed and expired',
    },
    401: errorResponse('No session'),
    403: errorResponse('Not an admin'),
  },
});

// No `AuthedEnv` — the sweep reads no session user (requireAdmin guards it in
// ../index.ts); registered on the main app like the admin shipping route.
export const reconcileHandler: RouteHandler<typeof reconcileRoute> = async (
  c,
) => {
  const result = await reconcilePayments();
  return c.json(apiSuccess(result), 200);
};

// ── GET /payments/zarinpal/callback (unauthenticated redirect) ────────────────

// Zarinpal appends these to the callback URL. Validated as an external boundary;
// a malformed callback cannot be tied to an order, so it goes to the generic
// failure page WITHOUT any database write.
const callbackQuerySchema = z.object({
  Authority: z.string().min(1),
  Status: z.enum(['OK', 'NOK']),
});

export const paymentCallbackHandler = async (c: Context) => {
  const parsed = callbackQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.redirect(checkoutFailurePath(), 302);

  const { Authority, Status } = parsed.data;
  const payment = await PaymentDao.getByAuthority(Authority);
  // Unknown authority — nothing to settle and no order to show. Failure page.
  if (!payment) return c.redirect(checkoutFailurePath(), 302);

  try {
    await handleCallback(payment, Status, getZarinpalClient());
  } catch (error) {
    // A transient gateway/verify error: never hand a browser the 500 JSON
    // envelope. The attempt stays `pending`, so the reconcile sweep recovers the
    // money; send the shopper to the order's result page (it reads the order
    // status, so it shows "still pending / retry").
    console.error(
      '[payments] callback settle failed; left for reconcile',
      error,
    );
    Sentry.captureException(error, {
      extra: { paymentId: payment.id, orderId: payment.orderId },
    });
  }
  // Both success and failure land on the result page for the order; it renders
  // from GET /api/orders/:id, so it shows the real settled status, not the query.
  return c.redirect(checkoutResultPath(payment.orderId), 302);
};

// ── Dev-only mock gateway (only responds when the provider is `mock`) ─────────
// These stand in for Zarinpal's hosted StartPay page. Guarded on the PROVIDER,
// not NODE_ENV: a test deployment runs a production build yet must keep the mock
// flow, and a real deployment (provider `zarinpal`) makes these 404.

const mockGatewayQuerySchema = z.object({ authority: z.string().min(1) });

const mockCompleteBodySchema = z.object({
  authority: z.string().min(1),
  action: z.enum(['pay', 'fail', 'abandon']),
});

// Escape at the render boundary so a caller can never forget it. The authority
// is a server-minted DB value today (mock `mock-…`, or Zarinpal's alphanumeric),
// so this is defense-in-depth — but interpolating any value into HTML unescaped
// is exactly the injection the standing "validate/escape at trust boundaries"
// rule exists to refuse, and the amount already goes through formatToman.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const mockGatewayPage = (authority: string, amount: number): string => `
<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>درگاه پرداخت آزمایشی — ${SITE_FULL_NAME}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.8; }
      .amount { font-size: 1.5rem; font-weight: 700; }
      form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1.5rem; }
      button { padding: 0.75rem 1rem; font-size: 1rem; border-radius: 0.5rem; border: 1px solid #ccc; cursor: pointer; }
      .pay { background: #16a34a; color: #fff; border-color: #16a34a; }
      .fail { background: #dc2626; color: #fff; border-color: #dc2626; }
      .abandon { background: #f3f4f6; }
      .note { color: #6b7280; font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <h1>درگاه پرداخت آزمایشی</h1>
    <p class="note">این صفحه جای درگاه واقعی زرین‌پال را در حالت آزمایشی می‌گیرد.</p>
    <p>مبلغ قابل پرداخت: <span class="amount">${formatToman(amount)}</span></p>
    <form method="post" action="${API_PATHS.PAYMENT_MOCK_COMPLETE}">
      <input type="hidden" name="authority" value="${escapeHtml(authority)}" />
      <button class="pay" name="action" value="pay" type="submit">پرداخت موفق</button>
      <button class="fail" name="action" value="fail" type="submit">لغو / پرداخت ناموفق</button>
      <button class="abandon" name="action" value="abandon" type="submit">رها کردن (بستن مرورگر)</button>
    </form>
  </body>
</html>`;

const mockAbandonPage = (): string => `
<!doctype html>
<html lang="fa" dir="rtl">
  <head><meta charset="utf-8" /><title>پرداخت رها شد</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.8;">
    <h1>پرداخت رها شد (آزمایشی)</h1>
    <p>هیچ بازگشتی به فروشگاه انجام نشد؛ سفارش در انتظار پرداخت باقی می‌ماند تا وظیفهٔ تطبیق آن را بررسی کند.</p>
  </body>
</html>`;

export const mockGatewayHandler = async (c: Context) => {
  if (getZarinpalProvider() !== 'mock') return c.notFound();
  const parsed = mockGatewayQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.redirect(checkoutFailurePath(), 302);
  const payment = await PaymentDao.getByAuthority(parsed.data.authority);
  if (!payment) return c.redirect(checkoutFailurePath(), 302);
  return c.html(mockGatewayPage(parsed.data.authority, payment.amount));
};

export const mockCompleteHandler = async (c: Context) => {
  if (getZarinpalProvider() !== 'mock') return c.notFound();
  const parsed = mockCompleteBodySchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.redirect(checkoutFailurePath(), 302);

  const { authority, action } = parsed.data;
  const payment = await PaymentDao.getByAuthority(authority);
  if (!payment) return c.redirect(checkoutFailurePath(), 302);

  // Pay and Abandon both "move the money" in the ledger; only Pay returns to the
  // callback. Abandon leaves a paid ledger entry with no callback — exactly the
  // "paid then closed the browser" case the reconcile sweep exists to settle.
  if (action === 'pay' || action === 'abandon') {
    mockLedger.markPaid(authority, payment.amount);
  }

  const callbackWith = (status: 'OK' | 'NOK') =>
    c.redirect(
      `${API_PATHS.PAYMENT_CALLBACK}?Authority=${encodeURIComponent(
        authority,
      )}&Status=${status}`,
      302,
    );

  if (action === 'pay') return callbackWith('OK');
  if (action === 'fail') return callbackWith('NOK');
  return c.html(mockAbandonPage());
};
