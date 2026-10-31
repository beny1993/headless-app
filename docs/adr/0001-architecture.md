# ADR 0001: Platform architecture

- Status: proposed (Phase 0)
- Date: 2026-10-31
- Deciders: Benyamin

## Context

Smokey (`beny1993/smokey-shop`) is a production Persian pet shop. About 80% of its code is
general Iranian commerce: phone-OTP auth, an order state machine with snapshots and atomic
stock decrement, idempotent Zarinpal verification, card-to-card with receipt review and
expiry sweeps, provinces and Tehran courier, discount codes, Persian search, Toman/Jalali
formatting, storage and SMS seams, a mobile-friendly RTL admin. The pet-specific part is
small and listed in `docs/extraction-map.md`.

We want a product where any Iranian shop (pet, clothing, cosmetics, electronics, books,
food) signs up, picks a preset and gets a working shop (Persian RTL, English LTR, or both) on a subdomain or its own domain.
What Smokey lacks is not commerce features but three platform layers: **tenancy**, a
**configurable catalog**, and **themes**.

## Decision

### 1. Build on Smokey's code; do not adopt an e-commerce framework

The platform starts as a copy of Smokey's tree (history included) in a new repository, keeps
its shape, adds tenancy in place and strips pet code. Smokey keeps running from its own repo
until Phase 5 imports it as a tenant.

### 2. Product scope: SaaS shop builder first

Small shops buy a working shop, not an API. Phases 1-4 build the hosted builder. The public
headless API, typed SDK, scoped API keys and third-party webhooks come in Phase 6, after
there are paying shops. The internal API is already headless-shaped (Hono + zod-openapi; the
storefront reaches the domain only through `/api` and `src/logic/`), so nothing is lost by
waiting.

### 3. Shape: one Next.js app

- One Next.js 16 app: storefront, merchant admin (`/admin-panel`), Hono API at `/api`.
- Platform admin (tenants, plans, support) is a **role** and a route group, not a separate
  app.
- Tenant resolved from the `Host` header for every page and API request.
- Split into separate apps only when a second client (mobile app, agency storefront)
  actually exists.

### 3b. Languages and direction

The platform is multilingual: Persian (RTL) and English (LTR) at launch, more locales by
adding a registry entry and a message file. Each shop picks its default and enabled
languages; merchant-entered shopper-facing text is stored per locale. Details in ADR 0004.

### 4. Stack: unchanged from Smokey

Next 16 App Router, React 19, TypeScript strict, Postgres 17 + Drizzle, Better Auth phone
OTP, Tailwind v4, Vitest 5, Playwright, ESLint 10 + Prettier, Node 24, pnpm 11, Docker for
dev Postgres. Hosting on Iranian infrastructure (Coolify/Docker or an Iranian PaaS); no
Vercel or AWS runtime. Self-hosted error tracking (GlitchTip or self-hosted Sentry), npm and
Docker mirrors, data in Iran.

### 5. Tenancy

One database, `tenant_id` on every business table, enforced twice: Postgres Row-Level
Security **and** DAO scoping. Full contract in ADR 0003. Customers are per tenant on top of
one global phone identity (ADR 0002). Tenant secrets are encrypted at rest (ADR 0003 §8).

A single-tenant deployment of the same code (own database) is the escape hatch for a large
customer. We design so it stays possible (no cross-tenant joins in business logic) but do
not build it.

### 6. Domains

- Trial shops live on `<slug>.<platform-domain>` (wildcard DNS + wildcard certificate).
- **Custom domains arrive in Phase 1**, not later: Enamad is issued per domain, a shop's
  own Zarinpal merchant account needs Enamad, so a shop on a platform subdomain likely
  cannot take gateway payments. Card-to-card is the payment method that works on day one.
- Certificates for custom domains: automatic ACME issuance must be tested from the Iranian
  servers in Phase 1 (Let's Encrypt reachability has been unreliable); a manual
  certificate upload path is the fallback.

### 7. Configurable catalog (Phase 2)

Per-tenant **product types** with typed **attribute definitions** (key, Persian label, type
text/number/boolean/select/multi-select/color, unit, required, `filterable`,
`variant_axis`). Values in validated `jsonb` with GIN indexes; the product zod schema is
generated from the type's definitions. Option-based variants generalize Smokey's families:
each variant stays its own SKU/price/stock row, so cart, stock decrement and order
snapshots do not change. Facets are generated from filterable attributes. Smokey's
`pet_type` becomes a multi-select attribute «مناسب برای» in the pet preset.

**Vertical presets** = product types + attributes + demo categories + theme + home
sections. Phase 2 ships pet and clothing.

### 8. Themes (Phase 3)

Theme = design tokens (colors, fonts from the bundled self-hosted set, radius) + an ordered
list of typed **sections** per page, stored as JSON, edited in the admin with live preview.
Smokey's `site_content` blocks and content editor are the starting point. Two or three
themes ship; pet-only sections (quiz, life moments, journey) live in the pet theme.
Code-level custom themes are for us and agencies, never uploaded by merchants.

### 9. Extensions (Phase 6, seams earlier)

- Typed provider interfaces in core: `PaymentProvider` (Zarinpal, card-to-card; later IDPay,
  Sep), `ShippingProvider` (province table, courier; later Tipax/Post), `SmsProvider`
  (console, SMS.ir today; Kavenegar), `StorageProvider` (local, S3-compatible).
  Smokey already has the seams for SMS, storage and Zarinpal; Phase 1 makes them take a
  tenant.
- Lifecycle events (order placed, paid, shipped, cancelled) through a transactional outbox.
- Plugins are **first-party code**, switched on per tenant. We never run uploaded
  third-party code in the multi-tenant process.
- Third parties integrate from outside: signed webhooks and scoped API keys.

### 10. Money

- Integer Toman `bigint` everywhere; Rial only at gateway/structured-data boundaries.
- Each shop uses its **own** Zarinpal merchant id and its own card number. Money goes
  straight to the merchant; the platform never holds shop funds, so it is not a payment
  facilitator under Shaparak rules.
- Platform revenue: prepaid plans (monthly / 6-month / yearly) via the platform's own
  Zarinpal, SMS reminders, a grace period, then read-only mode. Iranian gateways have no
  card-on-file recurring charges. Plan limits (products, staff, plugins, custom domain)
  enforced in core.

### 11. Iran-specific obligations

- Enamad and Samandehi seal fields per shop domain.
- VAT 10%, and invoice data shaped so it can later be sent to سامانه مودیان (the taxpayer
  e-invoicing system): seller/buyer identifiers, per-line tax, invoice serials per tenant.
- SMS cost model: OTP and order SMS cost money and need a registered template/line.
  Default: the platform's line with cost included in the plan and a per-tenant monthly SMS
  budget; a shop may bring its own SMS.ir/Kavenegar key (stored as a tenant secret).

### 12. Carried over unchanged (non-negotiables)

Integer Toman; UTC `timestamptz` rendered Jalali; zod on every external input with shared
client-safe contracts; DB only through DAOs, multi-DAO logic in `src/logic/`; the order
state machine; atomic `UPDATE … WHERE stock >= qty`; idempotent payment verify;
owner-scoped **and** tenant-scoped reads with mandatory IDOR and cross-tenant tests; phone
OTP only with canonical `+989…` phones; Persian search normalization + `pg_trgm`;
local-first (console SMS, local storage, mock gateway); UI copy in typed message files
with Persian as the source and English alongside (ADR 0004), logical CSS properties only;
English code/comments/commits; conventional commits; the unit + integration (real Postgres) +
component + Playwright testing standard.

**Generic by default:** no vertical-specific field, copy or enum in core. It belongs in a
preset, a theme or a plugin.

## Options considered and rejected

### Medusa (Node/TypeScript)

Strong modular commerce engine, but everything Iranian is missing: Toman-integer money
(Medusa's money model is decimal with currency codes, and Toman has no ISO code), Jalali
dates, phone-OTP-only auth, Zarinpal, card-to-card with receipt review, provinces and
courier, Persian search normalization. We would rebuild all of it as modules *and* fight an
admin that is English/LTR-first. Multi-store support is limited. Net: more work than
Phase 1, with no gain on the parts Smokey already solved.

### Saleor (Python + GraphQL)

A second stack to run and hire for, a GraphQL API we would have to wrap for a Persian
storefront, and the dashboard that is hardest to make RTL. Rejected.

### Vendure (TypeScript, NestJS)

The honest runner-up: TypeScript, a strong plugin system, and "channels" that give a form
of multi-store. Rejected because channels are a multi-*store* feature for one merchant, not
hard tenant isolation (no RLS, shared customers by default), and the same Iranian layer and
RTL admin work applies. **Optional de-risk:** a two-day spike implementing Zarinpal,
card-to-card and phone OTP on Vendure before Phase 1. If it feels natural, revisit this ADR.

### WooCommerce + Iranian plugins

The incumbent for Iranian shops that outgrow builders. Rejected as a base: PHP, the
plugin-security model we explicitly refuse (uploaded third-party code in the same process),
per-site hosting rather than multi-tenant, and slow storefronts without careful tuning. It
stays the main competitor for "serious" shops, so our pitch must answer it (speed, no
plugin maintenance, built-in Iranian flows).

### Starting a fresh monorepo and porting module by module

Doubles the work while we are also adding `tenant_id`. Rejected: keep Smokey's shape, split
when a second client exists.

## Why a shop would leave Sazito, Shopfa, Portal or Vitrin

These are hypotheses to test in the Phase 0 pilot interviews, not verified claims about
competitors' current feature sets. A small Iranian shop on a local builder today typically
juggles card-to-card payments by hand in Instagram/Telegram DMs, checks screenshots in a
chat, and reconciles stock in a spreadsheet. We would win on: **card-to-card done right**
(the receipt is attached at checkout, the order waits for review, stock is held and
released automatically, the shopper sees the status, the merchant gets one SMS), **shipping
built in** (31 provinces with per-province fees, Tehran courier paid on delivery),
**Persian search that actually finds things** (ي/ی, ك/ک, ZWNJ, typo-tolerant trigram),
**speed** (server-rendered Next.js on Iranian servers, no plugin bloat), and an **admin
that is genuinely good on a phone**, since most of these merchants run their shop from one.
Pricing must be at or below the local builders' entry plans; the pilots decide the number.
If the interviews show merchants are happy with these flows on their current builder, the
pitch (not the architecture) has to change before Phase 4.

## Consequences

- Phase 1 is the riskiest phase: most of the value and most of the risk is tenant
  isolation. Themes and billing do not start before cross-tenant isolation is proven by
  tests.
- Every PR touching data access says how tenant scoping is enforced (RLS + DAO) and carries
  a cross-tenant test that would fail without it.
- Smokey stays the reference implementation for Iranian commerce behaviour; ports keep its
  tests and behaviour.
- One app means one deploy and one scaling unit; per-process caches and rate limiters stay
  in memory until a second container is needed (Smokey's existing note), then move to a
  shared store.
