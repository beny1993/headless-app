# Extraction map: smokey-shop → the platform

Source: `beny1993/smokey-shop` at `main` (`dec502e`, 2026-10-22). `develop` is 9 commits
ahead; those land in the platform only through the normal port rule below.

Each module gets one verdict:

| Verdict | Meaning |
| --- | --- |
| **KEEP** | Moves over unchanged. Its tests move with it and must stay green. |
| **TENANT** | Same behaviour, but every row, key, cache entry or query becomes tenant-scoped (`tenant_id` + RLS per ADR 0003). Its tests move and gain a cross-tenant case. |
| **GENERALIZE** | The idea stays, the pet/Smokey-specific shape goes: becomes per-tenant config, a preset, a theme section or a provider. |
| **DROP** | Pet-specific. Deleted from core in Phase 1; it comes back (if at all) in the pet preset or pet theme in Phase 2/3. |

"Tests" lists the suites that pin the module today. Count at `main`: 251 test files
(`*.test.ts(x)`, `*.integration.test.ts`, 14 Playwright specs).

The port rule (from project instructions): behaviour stays identical unless a story says
otherwise, and the original tests come along. A story that changes a KEEP module's behaviour
must say so in its title.

---

## 1. Database schema (`src/db/schema/`)

| Table / enum | Verdict | Phase 1 change | Tests |
| --- | --- | --- | --- |
| `user`, `session`, `account`, `verification` (Better Auth) | **GENERALIZE** | `user` stays global (the identity is a verified phone, see ADR 0002). `role` leaves `user` and becomes `tenant_members.role`; `user.name` becomes per-tenant on `customers`. `session` gains `tenant_id` (checked on every request). Not RLS-scoped: Better Auth reads them by token/phone. | `schema/auth.test.ts`, `lib/auth/auth.integration.test.ts`, `lib/auth/phone-name-migration.integration.test.ts` |
| `otp_send_log` | **KEEP** (+ column) | Stays global (throttle per phone protects the handset across shops). Gains nullable `tenant_id` for per-tenant SMS cost accounting. | `schema/auth.test.ts`, `dao/OtpSendLogDao.integration.test.ts` |
| `rate_limit` (Better Auth buckets) | **KEEP** | Global; Better Auth's key already includes IP + path. | `schema/auth.test.ts` |
| `pets`, `pet_gender` enum | **DROP** | Removed. Returns as a pet-preset "customer profile extension" only if a pilot asks. | `dao/PetDao.integration.test.ts`, `lib/account/pet.test.ts`, `hono/routes/me-pets.integration.test.ts` |
| `addresses` | **TENANT** | `tenant_id`, RLS, owner = `customer_id` (not `user_id`). `province_id` stays a FK to global `provinces`. | `dao/AddressDao.integration.test.ts`, `lib/account/address.test.ts`, `hono/routes/me-addresses.integration.test.ts`, `features/account/addresses-tab.test.tsx` |
| `categories` | **TENANT** | `tenant_id`; `slug` unique becomes `(tenant_id, slug)`. One-level parent rule stays in `CategoryDao`, and the parent must be same-tenant (composite FK `(tenant_id, parent_id)`). | `schema/catalog.test.ts`, `dao/CategoryDao.integration.test.ts`, `lib/catalog/category-*.test.ts` |
| `products` | **TENANT + GENERALIZE** | `tenant_id`; `(tenant_id, slug)`, `(tenant_id, sku)`. **`pet_type` column and `pet_type` enum DROP** (Phase 2 brings `product_type_id` + `attributes jsonb`). `brand`, `benefit` stay as generic columns. Families (`variant_of`/`variant_label`) KEEP in Phase 1, generalized to option variants in Phase 2. All CHECKs keep. | `schema/catalog.test.ts`, `dao/ProductDao*.test.ts` (9 files) |
| `product_categories`, `product_images` | **TENANT** | `tenant_id` + composite FKs so a product can never point at another shop's category/image. | `schema/catalog.test.ts`, `dao/ProductDao.coverImageKeys.integration.test.ts` |
| `discount_codes`, `discount_type` enum | **TENANT** | `(tenant_id, code)` unique. | `dao/DiscountCodeDao.integration.test.ts`, `lib/discount/discount-code.test.ts`, `hono/routes/admin-discounts.integration.test.ts` |
| `orders` + enums | **TENANT** | `tenant_id`; `order_no` becomes a **per-tenant** sequence (shop A's first order is #1, and order numbers must not reveal another shop's volume); idempotency unique becomes `(tenant_id, customer_id, idempotency_key)`. Owner column `user_id` → `customer_id`. | `schema/orders.test.ts`, `dao/OrderDao*.integration.test.ts` (4) |
| `order_items`, `payments`, `payment_receipts` | **TENANT** | `tenant_id` + composite FK to the order. `payments.authority` unique stays **global** (a Zarinpal authority is globally unique, and the callback must find the payment before it knows the tenant; see ADR 0003 §6). | `schema/orders.test.ts`, `dao/PaymentDao.integration.test.ts`, `logic/payments/*.integration.test.ts` |
| `provinces` | **KEEP** (global reference data) | No `tenant_id`, readable by all, writable only by migrations/platform. Migration `0011_seed_provinces` keeps. | `schema/shipping.test.ts`, `seed/shipping-migration.integration.test.ts` |
| `shipping_rates` | **TENANT** | `(tenant_id, province_id)` unique. Each shop seeds its own fees at signup. | `dao/ShippingRateDao.integration.test.ts`, `hono/routes/shipping*.test.ts`, `admin-provinces*.test.ts` |
| `site_content` | **TENANT + GENERALIZE** | PK `(tenant_id, key)`. Phase 3 turns it into the theme's section store; Phase 1 only scopes it. Pet keys (`home.moments`, `home.journey`, `home.guide`, `home.routine`, `home.family`) DROP from the key enum in Phase 1 with their sections. | `dao/SiteContentDao.integration.test.ts`, `lib/content/*.test.ts`, `hono/routes/admin-content.integration.test.ts` |
| `columns.ts` (`createdAt`/`updatedAt`) | **KEEP** | Adds a shared `tenantId` column helper that defaults to `current_setting('app.tenant_id')`. | — |
| *new* `tenants`, `tenant_domains`, `tenant_members`, `customers`, `tenant_secrets`, `tenant_settings`, `tenant_counters`, `tenant_audit_log` | — | Phase 1 (see ADRs 0002/0003). | new |

`src/db/migrations/`: **KEEP history as-is**. Phase 1 adds forward migrations only (the
journal-order test `migrations/journal.test.ts` stays). The `0012_multi_pet_products`
data stays in history; a new migration drops the column. Smokey's own production DB is not
migrated with these; Phase 5 imports it as a tenant.

## 2. Data access (`src/db/dao/`, `src/db/index.ts`)

| Module | Verdict | Notes | Tests |
| --- | --- | --- | --- |
| `src/db/index.ts` (global `db` on a pool) | **GENERALIZE** | The heart of Phase 1. The global `db` stops being importable from app code; DAOs get their executor from the tenant context (`withTenant`, ADR 0003). Two pools: `app_user` (RLS) and `app_platform` (platform-admin only). | new: zero-rows + catalogue tests |
| `ProductDao` + `product-sql.ts` | **TENANT + GENERALIZE** | Drop `PET_SCOPE` and the pet filter; keep family scalars, orderings, category scope and the nested-`sql` correlated-subquery rule. Search (`search_text` + `pg_trgm`) keeps. | 9 files (`ProductDao*.test.ts`) |
| `CategoryDao`, `DiscountCodeDao`, `ShippingRateDao`, `SiteContentDao`, `AddressDao`, `ReceiptDao`, `PaymentDao`, `OrderDao` | **TENANT** | Mechanical: executor from context, no `tenantId` parameters in signatures (RLS + insert default do the scoping; DAOs still filter explicitly where a test can prove it). | one integration suite each (see §1), except `ReceiptDao`, which has none of its own and is covered through `logic/orders/receipts.integration.test.ts` (S4c adds one) |
| `UserDao` | **GENERALIZE** | Splits into `UserDao` (global identity: phone lookup, platform role) and `CustomerDao` (tenant-scoped profile: name, admin list/search, `lockForCheckout`). Admin user list becomes the shop's *customer* list. | `UserDao.test.ts`, `UserDao.admin*.integration.test.ts` (2), `UserDao.lockForCheckout.integration.test.ts` |
| `PetDao` | **DROP** | | `PetDao.integration.test.ts` |
| `OtpSendLogDao`, `HealthDao`, `like-pattern.ts` | **KEEP** | | `OtpSendLogDao.integration.test.ts` |
| `pg-error.ts`, `test-db.ts`, `test-global-setup.ts`, `*-test-fixtures.ts` | **KEEP + extend** | Fixtures gain `withTestTenant()`; `deactivateStaleTestProducts` runs per tenant. | `pg-error.test.ts` |

## 3. Domain logic (`src/logic/`)

All of `src/logic/` is general commerce; nothing in it is pet-specific except the admin user
detail. Every module is **TENANT** (runs inside the request's tenant context) unless noted.

| Module | Verdict | Notes | Tests |
| --- | --- | --- | --- |
| `checkout/create-order.ts`, `discount.ts`, `preview-discount.ts`, `get-order.ts`, `resumable-order.ts`, `checkout-error.ts` | **TENANT** | Re-pricing, atomic `UPDATE … WHERE stock >= qty`, idempotency key, rate cap: identical. Cap counts become per tenant+customer. | `create-order.*.integration.test.ts` (6, incl. `isolation`), `get-order`, `resumable-order` |
| `orders/state-machine.ts`, `admin-transition.ts`, `shopper-cancel.ts`, `receipts.ts`, `get-admin-order.ts` | **TENANT** (logic KEEP) | State machine untouched. | `state-machine`, `admin-transition`, `shopper-cancel`, `receipts` integration suites |
| `orders/order-sweeps.ts`, `expire-receipt-orders.ts` | **TENANT** (iterate tenants) | Background job: lists active tenants from `tenants` (not RLS), then runs each tenant's sweep in its own `withTenant`. Never uses a BYPASSRLS role. | `order-sweeps.test.ts`, `expire-receipt-orders.integration.test.ts` |
| `orders/notify-new-order.ts` | **TENANT + GENERALIZE** | Recipients = that tenant's members with a phone (not global admins). SMS goes through the tenant's SMS provider/line (ADR 0002 §7). | `notify-new-order*.test.ts` (3) |
| `orders/dashboard-report.ts` | **TENANT** | | `dashboard-report*.test.ts` (2) |
| `payments/request.ts`, `verify.ts`, `reconcile.ts` | **TENANT + GENERALIZE** | Zarinpal client built per tenant from the tenant's encrypted merchant id. Verify stays idempotent on `authority`. The callback resolves the tenant from the Host first, then checks the payment row's `tenant_id` matches. | `request`, `verify`, `reconcile` integration suites |
| `admin/product-removal.ts`, `product-images.ts` | **TENANT** | Image keys become tenant-prefixed. | `product-removal.integration.test.ts`, `product-images.test.ts` |
| `admin/product-insights.ts` | **TENANT + GENERALIZE** | Per-pet roll-up (`pets: GroupInsight[]`) **DROP** (with `features/admin-panel/insights/insight-sections.tsx`). Umami website id per tenant (or off). | `product-insights.test.ts` |
| `content/featured-picks.ts`, `link-targets.ts` | **TENANT** | | 2 suites |
| `seo/stocked-shelves.ts` | **TENANT + GENERALIZE** | Drop pet shelves; shelves = categories (Phase 2: + filterable attributes). | `stocked-shelves.test.ts` |
| `storefront/cached-reads.ts` | **TENANT** | Cache keys and tags gain the tenant id (see `lib/cache`). | `cached-reads.integration.test.ts` |
| `users/get-admin-user.ts` | **GENERALIZE** | Becomes `get-admin-customer.ts`; pets section DROP. | `get-admin-user.test.ts` |

## 4. Libraries (`src/lib/`)

| Module | Verdict | Notes | Tests |
| --- | --- | --- | --- |
| `auth/index.ts` (Better Auth config) + `app/api/auth/[...all]/route.ts` | **GENERALIZE** | The route handler resolves the host itself (Better Auth is not behind Hono). Host-aware instance (dynamic `baseURL` with `allowedHosts`, or one instance per verified host), session bound to tenant, temp email (`<digits>@phone.smokey.invalid` today) becomes `<digits>@phone.invalid` and stays globally unique. ADR 0002. | `auth/index.test.ts`, `auth.integration.test.ts` |
| `auth/phone.ts`, `otp-throttle.ts`, `otp-guard.ts`, `otp-echo.ts`, `next-path.ts`, `client-ip.ts` | **KEEP** | Throttle per phone stays global; a per-tenant daily SMS budget is added beside it. | one suite each |
| `auth/session.ts` (`requireAdmin`, `requireSession`) | **GENERALIZE** | `requireMerchant(role)` checks `tenant_members` for the *request's* tenant; `requirePlatformAdmin()` new. | `session.test.ts` |
| `auth/admin-bootstrap.ts` | **GENERALIZE** | Bootstraps a tenant owner, not a global admin. | `admin-bootstrap.test.ts` |
| `hono/index.ts`, `create-router.ts`, `envelope.ts`, `route-responses.ts`, `image-upload.ts`, `product-schema.ts` | **KEEP** (+ tenant middleware) | A `resolveTenant` middleware mounted before `rateLimit` (both before the first route, per Smokey's wildcard rule). `product-schema.ts` loses `petTypes`. | `app.test.ts`, `create-router.test.ts`, `envelope.test.ts`, `image-upload.test.ts` |
| `hono/middleware/auth.ts` | **GENERALIZE** | `requireAdmin` → `requireMerchant`. | `auth.test.ts` |
| `hono/middleware/rate-limit*.ts` | **TENANT** | Bucket key `tenant:caller:route`, plus a per-tenant ceiling so one noisy shop cannot starve the process. | `rate-limit.test.ts`, `e2e/rate-limit.spec.ts` |
| `hono/middleware/invalidate-cache.ts` | **TENANT** | Invalidates the tenant's tags only. | `invalidate-cache.test.ts` |
| `hono/routes/*` | **TENANT** | All routes; `me-pets.ts` **DROP**; `catalog.ts` loses the pet filter. Admin routes switch guard. | 20 route suites |
| `cache/store.ts` | **TENANT** | Key = `tenantId + key`, tags per tenant. Its own "one container, one cache" note stays true. | `store.test.ts` |
| `catalog/product-query.ts` | **GENERALIZE** | `PET_TYPES`/pet filter **DROP**; the shared client-safe contract pattern KEEP (it is the model for Phase 2's generated attribute filters). | `product-query.test.ts` |
| `catalog/product-input.ts` | **GENERALIZE** | Loses `petTypes`; Phase 2 adds generated attribute validation. | `product-input.test.ts` |
| `catalog/variant.ts`, `sku.ts`, `search-text.ts`, `category-*.ts`, `product-delete.ts` | **KEEP** | `search-text.ts` is the Persian normalization (ي→ی, ك→ک, ZWNJ). | one suite each |
| `checkout/*`, `orders/*`, `discount/*`, `shipping/*`, `insights/*`, `pagination.ts`, `format.ts`, `validation/text.ts`, `warn-once.ts`, `utils.ts`, `api-client.ts`, `admin-url.ts` | **KEEP** | `orders/delivery-method.ts`: Tehran courier becomes a per-tenant toggle + city (Phase 1: setting; default off for non-Tehran shops). | one suite each |
| `account/address.ts` | **KEEP** | | `address.test.ts` |
| `account/pet.ts` | **DROP** | | `pet.test.ts` |
| `content/site-content.ts`, `defaults.ts`, `link.ts`, `chrome.ts` | **TENANT + GENERALIZE** | Pet keys drop; the saved-link contract's `pet` field (`link.ts`) DROP; defaults lose Smokey copy (social handles `smokey.petshop`, Persian pet copy) and come from the tenant's preset. `checkout.payment` card number moves to `tenant_secrets`-adjacent settings (ADR 0003 §8). | 3 suites |
| `constant/paths.ts` | **KEEP** (−pet paths) | | `paths.test.ts` |
| `constant/support.ts` (`SUPPORT_PHONE`) | **GENERALIZE** | Per-tenant setting. | — |
| `sms/index.ts` (console + SMS.ir drivers) | **GENERALIZE** | Becomes `SmsProvider` with per-tenant config (platform line or the shop's own key). Kavenegar driver later. Templates gain the shop name. | `sms/index.test.ts` |
| `storage/*` (local + S3/Liara, receipts unlisted) | **TENANT** | Keys prefixed `t/<tenantId>/`; the receipt-key refusal in `url()` keeps; the `/uploads/[...key]` route checks the prefix matches the request's tenant. | 7 suites |
| `zarinpal/client.ts` | **GENERALIZE** | `getZarinpalClient(tenant)`; merchant id from decrypted tenant secret; `assertMockGatewayAllowed`/`assertReadyToServe` stay. The callback URL (today from `getAppBaseUrl()`, also in `logic/payments/request.ts`) becomes the request's own host. | `client.test.ts`, `zarinpal-driver.test.ts` |
| `seo.ts` | **GENERALIZE** | Site name, origin, Latin name, JSON-LD organization come from the tenant + its primary domain. `rialForStructuredData` KEEP. | `seo.test.ts`, `app/seo.test.ts` |
| `sentry.ts`, `sentry-privacy*` | **KEEP** | Add `tenant` tag. DSN points at self-hosted GlitchTip/Sentry. | 4 suites |
| `umami/client.ts` | **GENERALIZE** | Per-tenant website id; one platform Umami. | `umami/client.test.ts` |
| `users/user-search.ts` | **KEEP** (renamed customer search) | | `user-search.test.ts` |
| `utils/env.ts` | **KEEP** (+ vars) | Adds `APP_CONFIG_PLATFORM_DOMAIN`, `APP_CONFIG_SECRETS_KEYRING`, `APP_CONFIG_DATABASE_PLATFORM_URL`. Per-shop values (Zarinpal merchant id, SMS key, Umami id) **leave env** for tenant settings; env keeps only platform defaults. | `env.test.ts` |
| `fonts.ts` | **KEEP** (theme picks among bundled fonts in Phase 3) | | — |
| `src/constants.ts` (`DEFAULT_SITE_NAME`, `SITE_LATIN_NAME`, origin) | **GENERALIZE** | Replaced by tenant identity; the constants file keeps only the *platform's* name/origin. | `app/brand-assets.test.ts` |

## 5. Storefront and admin UI (`src/features/`, `src/app/`)

| Area | Verdict | Notes | Tests |
| --- | --- | --- | --- |
| `storefront/home/`: `hero`, `categories`, `recommends`, `featured*`, `philosophy`, `section-links` | **GENERALIZE** | Become theme sections (Phase 3). Phase 1 keeps them rendering from tenant content with neutral defaults. | `featured.test.ts`, `content.test.ts`, `section-links.test.tsx` |
| `storefront/home/`: `quiz`, `life-moments`, `journey`, `community`, `routine` | **DROP** | Move to the pet theme in Phase 3 (the code is kept in git history; copy from Smokey's tree when building the pet theme). | `quiz.test.ts`, `life-moments.test.tsx`, `journey.test.tsx` |
| `storefront/about/` | **GENERALIZE** | Theme page. | `about/page.integration.test.ts` |
| `storefront/layout/` (navbar, footer, mobile menu, nav-links) | **GENERALIZE** | Logo, name, nav and footer copy from tenant content. Hard-coded Smokey copy removed. | `footer.test.tsx`, `mobile-menu.test.tsx` |
| `storefront/cart/` | **TENANT** | localStorage key namespaced by tenant (`cart:<tenantId>`), since two shops on one browser must not share a cart. | 5 suites |
| `storefront/product/` | **KEEP** (−pet) | `product-seo.ts` loses the pet keyword; `spec-row`/`product-tabs` show generic fields (Phase 2: attributes). Gallery, chips, availability, card price KEEP. | 5 suites |
| `storefront/shop/` | **GENERALIZE** | Pet filter in `shop-filters.tsx`/`shop-query.ts`/`shop-metadata.ts` **DROP**; category, price, search, in-stock KEEP. Phase 2 adds attribute facets. | `shop-filters.test.tsx`, `shop-query.test.ts`, `shop-metadata.test.ts`, `shop-search.test.tsx`, `e2e/shop-filters.spec.ts` |
| `storefront/maintenance/` | **TENANT** | Maintenance becomes a per-tenant flag (plus platform-wide env flag). | `(store)/layout.test.ts` |
| `checkout/` (form, card-to-card, receipt box/picker, retry payment, cancel) | **KEEP** | Card number and support line from tenant settings. All 14 suites KEEP, notably `checkout-form.receipt.test.tsx`. | 14 suites, `e2e/checkout.spec.ts`, `e2e/courier.spec.ts` |
| `account/` (view, addresses tab, UI) | **KEEP** | | `account-view.test.tsx`, `addresses-tab.test.tsx` |
| `account/pets-tab.tsx`, `pet-facts.tsx` | **DROP** | | — |
| `auth/login/`, `sign-out-button` | **KEEP** | Login shows the shop's name. | 2 suites, `e2e/auth.setup.ts` |
| `admin-panel/*` (orders, products, categories, discounts, shipping, content, dashboard, insights, shell, shared) | **KEEP / TENANT** | Guard switches to `requireMerchant`. `products/product-form.tsx` loses the pet picker and `products/products-query.ts` its `pet` filter. `content/block-fields.ts` + `link-picker.tsx` lose pet blocks. `users/` becomes customers. | 17 suites, `e2e/admin*.spec.ts` (7) |
| `src/app/(admin-panel)`, `(app)`, `api`, `uploads`, `sitemap.ts`, `robots.ts`, `layout.tsx` | **TENANT** | Root layout reads the tenant (name, lang/dir stay `fa`/`rtl`). `sitemap`/`robots` per host. New `(platform)` route group for platform admin later (Phase 4). | `app/*.test.ts`, `sitemap.test.ts`, `uploads/[...key]/route.test.ts` |
| `components/`, `hooks/` | **KEEP** | | 5 suites |

## 6. Scripts, seeds, assets, tooling

| Item | Verdict | Notes |
| --- | --- | --- |
| `scripts/create-admin.ts` | **GENERALIZE** | `pnpm create-tenant <slug> <owner-phone> [--preset]` + `pnpm grant-platform-admin <phone>`. |
| `scripts/seed-catalog.ts`, `src/db/seed/catalog*.ts`, `public/products/*`, `public/site/*` | **DROP from core** | Phase 1 ships a neutral two-tenant demo seed (`seed-demo`) with generic products; Smokey's catalog becomes the pet preset's demo data in Phase 2. |
| `scripts/seed-shipping.ts`, `seed/shipping*.ts` | **TENANT** | Seeds a tenant's rates; provinces stay global via migration. |
| `scripts/migrate.mjs`, `build-local.mjs`, `load-env.ts`, `verify-s3-storage.ts`, `verify-sms.ts` | **KEEP** | `migrate.mjs` runs as the owner role (`APP_CONFIG_DATABASE_MIGRATE_URL`). |
| `public/brand/*`, favicons, `site.webmanifest` | **GENERALIZE** | Platform branding replaces Smokey's; per-tenant logo/favicon via storage (manifest generated per host). |
| `Dockerfile`, `docker-compose-dev.yaml`, `.dockerignore` | **KEEP** (+ init SQL) | Dev Postgres gets an init script that creates `app_user` and `app_platform` roles. |
| `.husky/*`, commitlint, lint-staged, ESLint, Prettier, tsconfig | **KEEP** | ESLint adds a `no-restricted-imports` rule: `@/db` (the raw pool) importable only from `src/db/**`. |
| `AGENTS.md` / `CLAUDE.md` | **GENERALIZE** | Rewritten for the platform; Smokey-only sections (Obsidian vault paths, Search Console service account, Smokey domain) removed. |
| `docs/DEPLOY.md` | **GENERALIZE** | Adds roles, keyring, wildcard DNS/TLS for subdomains, custom-domain certificates. |
| `.claude/launch.json`, `.claude/settings.json` | **KEEP** | |
| `e2e/*` | **KEEP + extend** | Every spec runs against tenant A; a new `cross-tenant.spec.ts` drives two hosts (`a.localhost`, `b.localhost`). |

## 7. Missing in Smokey (new in Phase 1)

- Tenant registry, domains, members, customers, settings, secrets (+ DAOs).
- `withTenant` context, RLS migrations, DB roles, zero-rows + RLS-catalogue tests.
- Host → tenant resolution middleware (Next `proxy`/middleware for pages, Hono middleware for `/api`).
- Secrets keyring (AES-256-GCM) and its tests.
- CI workflow: Smokey has none in `.github/` (gates run only in husky hooks).
