# ADR 0002: Per-tenant customers on Better Auth

- Status: proposed (Phase 0); decision needed from Benyamin on §2
- Date: 2026-10-31
- Related: ADR 0001 (architecture), ADR 0003 (RLS contract)

## Context

In Smokey, the person *is* the `user` row: `user.phone_number` is globally unique
(`src/db/schema/auth.ts`), `user.role` is `customer | admin`, `user.name` is the name the
admin sees, and every owner-scoped table (`orders`, `addresses`, `pets`) points at
`user.id`. Better Auth's `phoneNumber` plugin signs up on first verification
(`signUpOnVerification`, temp email `<digits>@phone.smokey.invalid`) and looks users up by
`phoneNumber` alone. OTP sends are throttled per phone in `otp_send_log` (90 s cooldown,
5 per hour) on top of Better Auth's IP-keyed limiter. Cookies use prefix `token`, one
`baseURL` from `NEXT_PUBLIC_APP_URL`, host-only (no `crossSubDomainCookies`).

On the platform, the same phone number is a separate customer in each shop: shop A must
never see that the person also buys at shop B, nor B's name, addresses or orders for them.
Merchants (owners, staff) also log in with a phone, and one person may own two shops and be
a customer of a third.

## Decision

### 1. Two layers: one global identity, many per-tenant profiles

| Table | Scope | Holds |
| --- | --- | --- |
| `user` (Better Auth) | **global**, not RLS | A verified phone and nothing personal. `phone_number` stays **globally unique**: it is the identity. `name` is left empty; `role` column removed. New `platform_role` (`null`, `support`, `admin`). |
| `session` (Better Auth) | global, not RLS | + `tenant_id NOT NULL`: the tenant whose host created it. |
| `account`, `verification`, `rate_limit` | global, not RLS | Unchanged. |
| `customers` | **tenant**, RLS | `(tenant_id, user_id)` unique, `name`, `created_at`. Everything a shop knows about a shopper hangs off `customers.id`. |
| `tenant_members` | **tenant**, RLS | `(tenant_id, user_id)` unique, `role` (`owner`, `staff`; later finer roles). Replaces `user.role = 'admin'`. |

Owner columns move from `user_id` to `customer_id` on `orders`, `addresses` and every
future per-shopper table. A shop's "users" admin page becomes its **customers** page and
can only ever read `customers` (RLS-scoped) joined to `user.phone_number` for display.
`UserDao` keeps only identity operations (find by phone, platform role); it has no list or
search method a tenant route could call.

The customer row is created lazily: `ensureCustomer()` in `src/logic/` runs on the first
authenticated tenant request that needs one (account page, checkout), inside the tenant
transaction. Checkout's per-account serialisation (`UserDao.lockForCheckout`, today a
`FOR NO KEY UPDATE` on the `user` row) moves to the `customers` row, so one person's
checkouts at two shops no longer queue behind each other, and Better Auth's verify
`UPDATE` on `user` no longer conflicts with a checkout lock.

### 2. Rejected alternative: per-tenant `user` rows

`user.tenant_id` with `unique (tenant_id, phone_number)`, a full Better Auth user per shop.

Rejected because Better Auth's adapter queries are not tenant-aware: the phone plugin does
`findOne(user where phoneNumber = ?)` and `verification where identifier = ?`. Making that
correct needs either an adapter wrapper that injects `tenant_id` into every query and
insert (fragile across Better Auth upgrades, and a silent leak if one path is missed), or
running Better Auth inside the RLS tenant transaction (Better Auth then owns transaction
boundaries we do not control). It also makes a merchant with two shops two unrelated
accounts, and platform admins a special case. The two-layer model keeps Better Auth stock
and puts every tenant-owned fact under RLS.

The cost of the chosen model: the global `user` table is one place where cross-tenant data
lives (a phone number and the fact it signed in somewhere). It holds nothing else, is
never reachable from a tenant-scoped route, and the RLS catalogue test (ADR 0003 §7) lists
it in the explicit allowlist of global tables.

**This is the decision Benyamin should confirm.**

### 3. Session bound to its tenant

- Better Auth is **not** behind Hono: it is mounted at
  `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler(auth)`), so Hono's middleware
  never sees `/api/auth/*`. That route handler resolves the host itself, answers 404 for
  an unknown host, and runs the handler of `getAuth(host)` inside `withTenant`. That is
  what lets the session hook, the per-tenant OTP text and the SMS budget know the tenant.
- `databaseHooks.session.create.before` sets `session.tenant_id` from that tenant.
- `getSession()` (our wrapper in `src/lib/auth/session.ts`) returns `null` when
  `session.tenant_id <> currentTenant().id`. A session cookie carried to another shop's
  host, by any means, is no session there.
- The wrapper alone does not cover Better Auth's own endpoints (`get-session`,
  `sign-out`, `list-sessions`), which would honour A's cookie on host B. So the instance
  secret is **derived per host** (HKDF of the platform secret and the host name): a cookie
  signed for host A fails signature verification on host B before any lookup. Changing a
  shop's primary domain therefore signs its shoppers out once; accepted.
- `disabledPaths` gains `/update-user` (already there), `/change-email` and
  `/delete-user`: names live on `customers`, and identity deletion goes through our own
  logic (§8).
- Sign-out and expiry unchanged (30 days).

### 4. Cookie scope

- Cookies stay **host-only**: never set `Domain`, never enable
  `advanced.crossSubDomainCookies`. A cookie set on `a.<platform>.ir` is not sent to
  `b.<platform>.ir` or to a custom domain.
- Use the `__Host-` cookie prefix in production if Better Auth's cookie options allow it
  (it forbids `Domain` and requires `Secure` and `Path=/`, which closes cookie tossing from
  a sibling subdomain). Spike in story S1.
- Merchants cannot run code on their subdomain (themes are JSON, plugins first-party), so
  sibling-subdomain cookie injection needs a platform bug, not a malicious merchant. Longer
  term, add the platform's shop domain to the Public Suffix List, as large hosted-shop
  platforms do, so browsers treat each subdomain as its own site.
- The platform apex (`<platform>.ir`, signup and platform admin) is its own host with its
  own sessions.

### 5. Multiple hosts on one Better Auth

Better Auth takes one `baseURL` and a `trustedOrigins` list; ours change at runtime as shops
add custom domains. Better Auth's **dynamic base URL** (`baseURL: { allowedHosts, protocol,
fallback }`, which also adds every allowed host to `trustedOrigins`) covers
`*.<platform>.ir`, but its `allowedHosts` is a static list. Two designs, decided by the S1
spike:

1. **Preferred:** a small `getAuth(host)` cache that builds one Better Auth instance per
   verified host (`baseURL: https://<host>`, `trustedOrigins: [that origin]`), created
   only after `resolveTenant` found the host in `tenant_domains`, evicted when a domain is
   removed. Every instance shares the same adapter, secret, plugins and hooks.
2. Dynamic `baseURL` with `allowedHosts: ['*.<platform>.ir', …]`, rebuilt when the
   custom-domain list changes.

Either way an unknown host is refused before Better Auth runs (no `fallback`).

### 6. OTP throttling and SMS cost

- The **per-phone** throttle stays **global** (one `otp_send_log` across shops). Its job is
  to protect a victim's handset and our SMS bill from one attacker rotating IPs and shops;
  splitting it per shop would multiply the budget by the number of shops. A shopper who
  logs into two shops within 90 seconds waits once; acceptable.
- `otp_send_log` gains a nullable `tenant_id` so we can count sends per shop. The
  per-tenant budget check and the global throttle run in the **same** transaction in
  `OtpSendLogDao`, so a burst cannot overshoot the budget.
- A **per-tenant** SMS budget (daily cap and monthly plan quota) is checked before every
  send; when it is exhausted the shop's owner is notified and OTP falls back to a
  "try later" refusal, never to a silent free send.
- Better Auth's IP limiter (`/phone-number/send-otp` 3/min, verify 10/min) unchanged.
- OTP text names the shop («کد ورود به {shop}: …»). With SMS.ir/Kavenegar templates the
  shop name is a template parameter; confirm the provider approves a template with a
  variable sender-side name before Phase 1 ends.
- Which line sends: the platform's registered line by default (cost in the plan); a shop
  may configure its own provider key (a tenant secret, ADR 0003 §8).

### 7. Authorization

- `requireMerchant(minRole)` (pages) and its Hono twin: a session for **this** tenant and a
  `tenant_members` row for (tenant, user) with at least that role.
- `requirePlatformAdmin()`: `user.platform_role = 'admin'` **and** the request is on the
  platform apex host. Platform admin never acts through a shop's host.
- Customer routes take `customer_id` from context (resolved from session + tenant), never
  from the URL or body, exactly like Smokey's `c.get('user')` rule.
- `pnpm create-tenant <slug> <owner-phone>` creates the tenant, its domain, the owner's
  identity (if new) and the `tenant_members` owner row. `pnpm grant-platform-admin <phone>`
  is the only way to set `platform_role`.

### 8. Privacy and deletion

- A shop deleting a customer deletes the `customers` row and cascades only that shop's
  data (addresses; orders anonymised, not deleted, for bookkeeping).
- A person deleting their identity removes `user` only when no `customers` or
  `tenant_members` rows reference it; otherwise each shop's data stays with that shop.

## Tests this ADR requires (Phase 1)

- Same phone signs in on host A and host B: one `user` row, two `customers` rows, two
  sessions with different `tenant_id`.
- Session cookie from host A presented on host B: treated as signed out (unit + E2E).
- Tenant A's customer list, search and detail never return tenant B's customer, even with
  B's `customer_id` in the URL (IDOR + cross-tenant).
- `requireMerchant` on host B refuses a member of tenant A only.
- OTP throttle: global per phone across two tenants; per-tenant budget exhaustion refuses
  only that tenant's sends.
- Platform admin route refuses on a shop host even for a platform admin.
