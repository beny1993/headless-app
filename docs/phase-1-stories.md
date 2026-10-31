# Phase 1 stories: tenant-aware core

Goal (from the roadmap): two demo tenants on two domains, each placing orders (card-to-card
and Zarinpal mock), cross-tenant tests green, pet code stripped.

Rules for every story: one story = one branch = one PR; CI green at merge; Fable plan
review before code and diff review before ready; every PR touching data access says how
tenant scoping is enforced (RLS + DAO) and includes a cross-tenant test that fails without
it; every PR storing a secret says how it is encrypted; ported behaviour stays identical to
Smokey unless the story says otherwise; each finished story is shown running locally with
two tenants (desktop + phone screenshots).

Order matters. The L stories (languages, ADR 0004) run as a parallel track: L1 after S2 (it needs host resolution for `src/proxy.ts`), L2 and L3 after S3 (they need `customers.preferred_locale` and the member's admin language), L4 after S4b. They touch UI files; the S stories mostly data access. S0-S2 build the foundation; S3 (identity) lands **before** any business
table moves, so orders and addresses move onto `customer_id` once, and no shop's admin
can act on another shop's data in between.

| # | Story (branch) | Scope | Done when |
| --- | --- | --- | --- |
| S0 | `chore/strip-pet-and-rebrand` | Rename package, platform branding constants, remove Smokey-only assets (logos, social handles, seed images). Drop pet code: `pets` table and tab, `pet_type` column/enum, shop and admin pet filters, the saved-link `pet` field, the insights per-pet roll-up, pet home sections, pet seed. Neutral seed with generic products. | No `pet` in `src/` outside migration history (grep test); all gates green; storefront renders with neutral copy |
| S1 | `spike/better-auth-multi-host` | Timeboxed (2 days), throwaway: Better Auth on two hosts via the route handler; per-host instance cache vs dynamic `baseURL`; per-host derived secret; `__Host-` cookie prefix; `session.tenant_id` hook; `app_auth` pool. Outcome appended to ADR 0002. | ADR 0002 §3-5 decided with evidence |
| L1 | `feat/i18n-foundation` | ADR 0004: locale registry (`fa` RTL, `en` LTR, both enabled platform-wide until S7 makes it per tenant), `src/proxy.ts` rewrite to `app/[locale]` with `next/root-params`, default locale unprefixed and `/en/…` prefixed, `<html lang dir>` from the locale, typed message files with `fa` as source, our own `t()` with a `<LocaleProvider>` shipping only the current locale, pure `format.ts` taking an explicit locale (digits, money label, Jalali/Gregorian), Latin font, ESLint rule against physical direction classes, direction-aware icons and drag-reorder arrows, `hreflang` + `x-default`. Strings extracted for the root layout, header, footer, home, shop and product pages. | Storefront browses fully in `fa` and `en`; E2E home → shop → product in both locales at 1280 and 375; no physical-direction class in `src/` |
| L2 | `feat/i18n-checkout-account` | Strings extracted for cart, checkout (incl. card-to-card and receipt flow), payment result, login, account; zod messages as keys (client via `t()`, API via `X-Locale`); `customers.preferred_locale`; SMS text per locale (first OTP uses the request locale). | Full shopper walk incl. card-to-card checkout in `en`; all checkout component tests pass in both locales |
| L3 | `feat/i18n-admin` | Admin panel strings extracted; per-member admin language preference; admin works in LTR. | Admin E2E specs pass in `fa` and a smoke walk in `en` |
| L4 | `feat/localized-catalog-content` | ADR 0004 §6: product and category text and `site_content` text become localized `jsonb` (`localizedText`, bare string accepted), CHECKs and title indexes rewritten against the default locale, `displayTitle` per locale, `order_items.title_shopper` + `title_locale`, `search_text` from every locale with the Latin fold on both sides, admin forms edit each enabled language. | A product edited in `fa` and `en` shows in each locale, falls back when `en` is empty, and is found by search in both scripts |
| S2 | `feat/tenant-registry-and-rls-foundation` | Global `tenants` + `tenant_domains` (`TenantDao` on `globalExecutor()`); `resolveHost` for Hono, the Better Auth route handler and RSC (`cache(headers())`); unknown host → 404; `pnpm create-tenant`; local hosts `a.localhost` / `b.localhost`. DB roles (`platform_owner` BYPASSRLS, `app_user`, `app_auth`) in the dev/CI init script and DEPLOY.md; `withTenant` / `withTenantTx` / async `executor()`; the policy migration helper; ESLint rules on raw pools; zero-rows, catalogue (with exact `PENDING` list), and pool-hygiene tests. **Reference table:** `shipping_rates` migrated end to end (nullable → backfill → NOT NULL, policy, `(tenant_id, province_id)`). | Two tenants resolve on two hosts with different shipping fees; RLS tests green; every other tenant table on `PENDING` |
| S3 | `feat/per-tenant-customers` | ADR 0002: `customers`, `tenant_members`, `platform_role`; `user.role` removed; session bound to tenant with host-derived secret; host-only cookies; `requireMerchant` / `requirePlatformAdmin`; admin customer list; checkout lock on `customers`; `orders.user_id` and `addresses.user_id` → `customer_id`; `addresses` under RLS. `pnpm create-tenant` creates the owner membership. | Same phone on A and B = one identity, two customers; A's cookie is signed out on B (E2E); A's owner gets 403 on B's admin |
| S4a | `feat/tenant-catalog` | `tenant_id` + RLS + per-tenant uniques + composite FKs on `categories`, `products`, `product_categories`, `product_images`; their DAOs on `executor()`; catalog routes and storefront reads; tenant-keyed cache. | Catalog cross-tenant suite green; A and B show different catalogs |
| S4b | `feat/tenant-content-discounts` | Same for `site_content`, `discount_codes`. | Cross-tenant suites green |
| S4c | `feat/tenant-orders-payments` | Same for `orders`, `order_items`, `payments`, `payment_receipts`; per-tenant `order_no` (`tenant_counters`, locked last); sweeps and reconcile iterate tenants; Zarinpal callback URL from the request host. | Checkout/receipt/payment suites green under two tenants; `PENDING` empty |
| S4d | `feat/tenant-storage` | Storage keys `t/<tenantId>/…` (local + S3); uploads route refuses another tenant's prefix; receipt rules kept; existing dev keys migrated. | A cannot fetch B's photo or receipt by key; storage suites green |
| S5 | `feat/tenant-secrets` | `src/lib/secrets` keyring (AES-256-GCM, AAD with tenant, name, key version), `tenant_secrets`, `tenant_audit_log`, merchant settings page for Zarinpal merchant id, SMS key, card number and support phone. Payout changes need owner role + fresh OTP; owner SMS on change. | Secret tests from ADR 0003 §8; no plaintext in a DB dump |
| S6 | `feat/tenant-providers` | Zarinpal client, SMS sender and Umami per tenant; per-tenant SMS budget checked atomically with the global per-phone throttle; OTP text with shop name; Sentry tenant tag; per-tenant rate-limit buckets and ceiling. | Two tenants with different merchant ids (mock) both pay; budget exhaustion refuses only that tenant |
| S7 | `feat/tenant-identity-seo` | Shop name, logo, favicon, manifest, SEO/JSON-LD, sitemap, robots per host; header/footer from tenant content; tenant `default_locale` and `enabled_locales` drive routing, the language switcher and `hreflang`; maintenance flag per tenant; cart localStorage namespaced. | Two hosts show two brands; SEO tests per host |
| S8 | `feat/custom-domains` | Add/verify a custom domain (DNS TXT check), primary domain + redirects, Enamad/Samandehi fields, certificate path (ACME test from Iranian servers + manual upload fallback documented). | A tenant served on a second domain; canonical URLs use the primary |
| S9 | `test/two-tenant-e2e` | `seed-demo` with two tenants of different look; Playwright `cross-tenant.spec.ts` on two hosts, one shop Persian-only and one bilingual with English; the whole existing suite runs on tenant A. | Phase 1 "done when" demonstrated: both tenants order with card-to-card and Zarinpal mock |

CI itself (GitHub Actions: static checks, unit + Postgres integration, Playwright, build
and audit) ships in Phase 0 with the new repo; S2 extends it with the role init script.

Open questions for Benyamin before S2:

1. Confirm ADR 0002's model (one global phone identity + per-tenant customers).
2. Platform domain for trial subdomains (needed for wildcard DNS/cert in S2/S8).
3. SMS default: platform line with cost in the plan, or each shop brings its own key?
4. Base the new repo on Smokey's `main` (proposed) or `develop` (9 commits ahead)?
