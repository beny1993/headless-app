# ADR 0004: Languages and text direction

- Status: proposed
- Date: 2026-10-31
- Deciders: Benyamin
- Related: ADR 0001 (architecture), ADR 0003 (tenant context, RSC vs ALS)

## Context

Smokey is Persian-only: `<html lang="fa" dir="rtl">` is hard-coded in `src/app/layout.tsx`
and `global-error.tsx`, Persian copy sits in roughly 200 non-test source files
(components, zod `error:` strings such as `lib/catalog/product-input.ts` and
`lib/validation/text.ts`, SMS text, SEO copy), and `src/lib/format.ts` always renders
Persian digits and Jalali dates. Styling already uses logical properties as a rule, and LTR
islands (phones, card numbers) are marked `dir="ltr"`. A few places hard-code RTL
behaviour: `hooks/use-drag-reorder.ts` maps `ArrowRight` to "previous", and `home/hero.tsx`
uses `left-*` on purpose for decoration.

Benyamin wants the platform multilingual: at least Persian + English, with RTL and LTR
both working, Persian staying the main language.

## Decision

### 1. Locales

- A code-level **locale registry**: `fa` (RTL) and `en` (LTR) at launch, each with `dir`,
  font set, digit system, default calendar and precompiled `Intl` formatters. Adding `ar`
  (RTL) or `tr`/`ku` later is a registry entry plus a message file.
- Each tenant has `default_locale` (default `fa`) and `enabled_locales` (default
  `['fa']`). A shop can be English-only.
- Merchant admin language is a per-member preference (on `tenant_members`), independent of
  the storefront's languages.

### 2. URLs and how the locale is resolved

- The tenant's default locale is unprefixed (`/product/x`), so Smokey's URLs and SEO stay as
  they are. Other enabled locales are prefixed (`/en/product/x`). Slugs stay Latin and
  shared by every locale.
- **Mechanism (Next 16):** a new `src/proxy.ts` resolves the host (`resolveHost`, ADR 0003)
  to read the tenant's default and enabled locales, then rewrites the request to an internal
  `app/[locale]/…` segment: `/en/x` → `[locale]=en`, `/x` → `[locale]=<tenant default>`; a
  prefix for a locale the tenant has not enabled is a 404. Excluded from rewriting: `/api`,
  `/_next`, `/uploads`, static files. The root layout reads the locale with
  `next/root-params` (`locale()`; see `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md`)
  and sets `<html lang dir>`.
- Server components get it from `getRequestLocale = cache(...)` (root params), the same
  pattern as `getRequestTenant` in ADR 0003 §3; never from AsyncLocalStorage.
- The API carries no locale prefix: `src/lib/api-client.ts` sends an explicit `X-Locale`
  header, and Hono validates it against the tenant's enabled locales (fallback: default).
- A `locale` cookie only remembers the switcher choice. `/` never redirects on the cookie;
  the switcher links to prefixed URLs. One URL is one page, for caches and search engines.
- `global-error.tsx` cannot read request scope; it is the one place `lang`/`dir` are
  constants (or read from the cookie), documented beside it.

### 3. UI strings

- Typed message files per locale (`src/i18n/messages/fa.ts`, `en.ts`). `fa` is the source:
  `en` is typed against it, so a missing key fails `type-check`, and a test fails on an
  empty value or one still in Persian script.
- **Our own small dictionary, not `next-intl`.** Every storefront page already renders at
  request time (tenant from `headers()`, `connection()` in `content/chrome.ts`), so
  `next-intl`'s static-per-locale rendering buys nothing, and the dependency diet holds.
  `t(key, params)` on the server; a `<LocaleProvider>` gives client components `t` and the
  locale, and ships **only the current locale's messages** to the browser. Plurals via
  `Intl.PluralRules`.
- **zod messages become keys.** Schemas carry `error: 'errors.product.titleRequired'`;
  client-side validation maps them with `t()`; Hono's `formatZodIssues` resolves them in the
  request locale (`X-Locale`), so `parseFieldErrors` keeps working unchanged.
- English copy is written by a person, not machine-translated at runtime.

### 4. Direction

- `<html lang dir>` from the locale (except `global-error.tsx`, §2).
- Logical properties stay mandatory and are now **enforced**: an ESLint rule rejects
  `ml-*`/`mr-*`/`pl-*`/`pr-*`/`left-*`/`right-*`/`text-left`/`text-right` in `src/`, with a
  per-line disable plus a reason for deliberate decoration (e.g. `hero.tsx`).
- Direction-bearing icons (arrows, chevrons, back) flip with `rtl:`/`ltr:` variants or a
  `<DirIcon>` wrapper. Keyboard arrows read `dir`: `use-drag-reorder.ts`'s hard-coded RTL
  mapping becomes direction-aware. Carousels and sliders follow `dir`.
- User content renders with `dir="auto"`; numbers, phones, SKUs, card numbers and codes
  stay `dir="ltr"` islands in both locales.
- Fonts: Vazirmatn (self-hosted, as today) for `fa`; a self-hosted Latin font for `en`
  (never `next/font/google`, which fails on Iranian infrastructure).

### 5. Formatting

`src/lib/format.ts` functions stay **pure** and take the locale as an explicit argument
(they run in client components such as the cart drawer and checkout, so they cannot read
request context). Callers pass `useLocale()` on the client or `await getRequestLocale()` on
the server.

| | `fa` | `en` |
| --- | --- | --- |
| Digits | Persian (۱۲۳) | Latin (123) |
| Money | `۱۲۰٬۰۰۰ تومان` | `120,000 Toman` |
| Dates | Jalali | Gregorian by default; a tenant setting can show Jalali in English |
| Phone display | `۰۹۱۲…` | `0912…` |

Money stays integer Toman everywhere. Input parsing (`parseDigits`, `toAsciiDigits`) already
accepts both digit systems.

### 6. Translatable data

- Merchant-entered text a shopper reads becomes a **localized value**: `jsonb`
  `{ "fa": "…", "en": "…" }`, validated by one zod helper
  `localizedText(enabledLocales, { required: defaultLocale })`. The default locale is
  required; others fall back to it. The helper also **accepts a bare string** as
  `{ [default]: s }`, so existing `site_content` blobs and old payloads stay valid (the
  content module's documented compatibility rule).
- Fields: product `title`, `description`, `benefit`, `variant_label`; category `title`;
  `site_content` text fields. Phase 2 adds attribute labels and option values; Phase 3
  theme section text. **Not** translated: slugs, SKUs, brand, province names (proper
  nouns), courier label (a code constant, so it goes in the message files), discount codes,
  and anything a customer types (addresses, notes, receipts).
- Constraints and indexes that assumed `text` are rewritten against the default locale:
  `products_variant_label_present`/`_visible` check `variant_label ->> <default>`; title
  sorting and admin title filter use an expression index on `(tenant_id, (title ->> 'fa'))`
  per registry locale.
- `displayTitle` (`lib/catalog/variant.ts`) takes a locale and resolves with fallback.
- **Order snapshots:** `order_items` keeps `title` (in the tenant default locale, so the admin
  always reads its own language) and adds `title_shopper` + `title_locale` (what the
  shopper saw). Not jsonb: a snapshot is two fixed strings.
- **Search:** one `search_text` per product built from every locale's title, brand and
  benefit, each normalized for its script: Persian normalization (existing
  `search-text.ts`) plus an import-free Latin fold (lower-case, strip diacritics via
  `normalize('NFD')`) applied identically on write and in the query normalizer, which also
  runs in the browser; no Postgres `unaccent`. One `pg_trgm` index. Trigram similarity is
  noisy on short Latin tokens, so the `word_similarity` threshold is tuned per script.
- **Caching:** cached reads store the whole localized value and resolve the locale at
  render, so one cache entry per tenant serves every locale and invalidation stays as it is.

### 7. Messages leaving the app

- SMS uses the recipient's locale: a customer's `preferred_locale` (the locale they last used
  in that shop), a member's admin locale for staff SMS. The **first OTP** (no customer yet)
  uses the request locale.
- SMS.ir/Kavenegar send provider-approved templates by id, so template ids are per tenant
  and per locale in the tenant's SMS settings (stories S5/S6), each needing approval.
- Invoices (VAT, سامانه مودیان) are Persian regardless of UI locale (the legal language);
  an English courtesy copy may come later.

### 8. SEO

- `hreflang` alternates for the tenant's enabled locales plus `x-default` → the default
  locale; per-locale canonicals; sitemaps list every locale.
- A product whose `en` fields are all fallback gets no `en` alternate (avoids duplicate
  content), and fallback text renders with `dir="auto"`.

### 9. Open question

Phone OTP stays `+989…` only. Accepting foreign numbers is a product decision (SMS routes,
cost, fraud), out of scope until a pilot asks.

## Consequences

- String extraction is the biggest mechanical change after tenancy, split into stories by
  area (storefront shell, checkout/account, admin) so each leaves CI green. Localized data
  fields are their own story, not folded into the tenant migrations.
- Every E2E spec runs in `fa`; the core shopper walk also runs in `en` at 1280 and 375,
  which is how LTR gets tested. Component tests render with an explicit locale.
- "Persian UI copy in components" (Smokey's rule) becomes "UI copy in message files, Persian
  as the source".
