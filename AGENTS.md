# Smokey Shop — agent guide

Persian (RTL) pet-shop e-commerce for Iran. Prices in Toman, Jalali dates,
phone-OTP customers, Zarinpal + card-to-card transfer. This file is the repo's source
of truth for agents; `CLAUDE.md` is a symlink to it.

Planning lives in the Obsidian vault: `Projects/smokey shop/` — board
`Smokey Shop Plan`, facts `Smokey Shop Info`, stories in `stories/`. One story =
one branch. Read the story note before touching code.

## Stack

Next 16 App Router (React 19, TypeScript strict) · Hono `@hono/zod-openapi` +
Scalar mounted at `/api/[[...route]]` · Postgres + Drizzle (schema / DAO /
migrations) · Better Auth · Tailwind v4 + shadcn-style primitives · Vitest ·
ESLint 9 + Prettier · husky + lint-staged + commitlint · pnpm 11 / Node 24 ·
Docker for dev Postgres.

No CMS. The commerce schema is ours, in Drizzle; the admin panel is a custom
`/admin` area built from the design prototype.

## Layout

| Path | What |
| --- | --- |
| `src/app/(app)/` | Public storefront (its own chrome layout; the one root layout and `src/app/globals.css` sit at `src/app/`, shared with the admin panel). Every page lives in `(store)`, whose layout is the `APP_CONFIG_MAINTENANCE_MODE` gate; only `login/` sits outside it, so admins can sign in while the shop is closed |
| `src/app/(admin-panel)/` | Admin panel: `(protected)` pages behind `requireAdmin()`. Sign-in is the storefront's `/login` — there is one login for the whole site |
| `src/app/api/[[...route]]/` | Hono catch-all; Better Auth at `src/app/api/auth/[...all]/` |
| `src/db/schema/`, `src/db/dao/`, `src/db/migrations/` | Drizzle schema, DAOs, generated migrations. `dao/product-sql.ts` is the product listing's SQL vocabulary — the family scalars, the orderings, the category and pet scopes — composed by `ProductDao` and imported by nothing else |
| `src/lib/hono/` | API app, router factory, response envelope, routes |
| `src/lib/hono/middleware/` | Cross-cutting middleware: the `requireAdmin`/`requireAuth` guards, and the `/api/*` rate limiter (the one deliberate `app.use('*')` — see its mount comment) |
| `src/lib/auth/`, `src/lib/utils/env.ts` | Better Auth, env accessor |
| `src/lib/sentry.ts` | The one `Sentry.init` options object, shared by all three runtimes (`register()` in `src/instrumentation.ts` for Node and edge, `src/instrumentation-client.ts` for the browser). Owns the privacy contract: explicit `dataCollection` opt-outs and the removal of the console-breadcrumb integration, without which every OTP in the server log rides along on the next event |
| `src/lib/content/` | Storefront editorial content: the client-safe zod schemas + key enum + area map + `isVisible` (`site-content.ts`), the saved-link contract + `resolveLink` (`link.ts`; its id → slug targets load in `src/logic/content/link-targets.ts`), the typed defaults + `resolveContent` fallback (`defaults.ts`), and the header/footer request-time read `readSiteChrome` (`chrome.ts`, `await connection()`). Values live in the `site_content` table; the page-organized admin editor is `/admin-panel/content/[area]` |
| `src/features/<area>/<feature>/` | Feature components; route files stay thin |
| `src/hooks/` | Shared client hooks (`@/hooks`). `use-modal-dialog.ts` is the one wiring for every native modal `<dialog>` — mobile menu, cart drawer, shop filter sheet |
| `src/lib/catalog/variant.ts` | Product families: `displayTitle` (the **single** derivation used by the product heading, the admin list and the `order_items` snapshot), the label cap and the Persian refusals. A family is `products.variant_of` + `variant_label` — a member is an ordinary product row, so the cart, the stock decrement and `order_items` are untouched; the storefront lists `variant_of is null` and reaches members from the head's page |
| `design/` | **Canonical design reference** — vendored Figma prototype (own deps, own `pnpm dev` on :5173). FE stories port from it. Never imported by the app. |
| `scripts/create-admin.ts` | Grant admin by phone (`pnpm create-admin <phone> [name]`) — creates or promotes |
| `src/db/seed/`, `scripts/seed-catalog.ts` | Demo catalog seed (`pnpm seed-catalog`), idempotent; its images live in `public/products/` |
| `scripts/seed-shipping.ts` | Seed all 31 provinces + placeholder shipping rates (`pnpm seed-shipping`), idempotent (upserts by name, never resets a tuned fee). Migration `0011_seed_provinces` plants the same 31 in every environment — production cannot run this script — adding only what is missing and recognising a hand-typed spelling (spaces/ZWNJ) as the same province; pinned by `src/db/seed/shipping-migration.integration.test.ts` |
| `e2e/`, `playwright.config.ts` | Playwright E2E suite (`pnpm test:e2e`): the core-flow regression walk — see *End-to-end tests* under Testing standard |

## Conventions

- **Always validate with zod (Benyamin's standing rule, 2026-08-31).** Every
  external input crosses a zod schema: API params/bodies, page `searchParams`,
  env access, storage payloads. Shared contracts live in ONE client-safe module
  that both sides import — derive, never hand-mirror (the pattern:
  `src/lib/catalog/product-query.ts`, consumed by both the Hono route and
  `shop-query.ts`; hand-mirroring caused a 500-class drift bug once already).
  Pages degrade invalid input via `.catch()`; APIs reject with 400.

- **DB access only through DAOs** in `src/db/dao/`. Multi-DAO operations go in
  `src/logic/` (create it when needed) — never in route handlers or components.
  Never write raw SQL. Schema change → `pnpm migration:generate` + review the SQL.
- **API routes**: a `createRoute` definition plus a separate typed `RouteHandler`
  export in the same file (see `src/lib/hono/routes/health.ts`), registered with
  `app.openapi(route, handler)`. Sub-routers come from `createRouter()`.
- **Envelope**: every response is `{ status: 'success', data }` or
  `{ status: 'error', message, errors? }` (`src/lib/hono/envelope.ts`). Client
  components write with the `*Data`/`postForm` helpers in `src/lib/api-client.ts`
  (browser-only); server components read through `src/logic/` and the DAOs.
- **Env vars**: names live in the `VARS` enum in `src/lib/utils/env.ts`, template
  in `.env.example`. `NEXT_PUBLIC_*` must also be listed in `STATIC_INLINED_VARS`
  there. Never commit `.env`.
- **Route paths**: import from `src/lib/constant/paths.ts`; never hardcode.
- **Persian display formatting**: every number, price and date goes through
  `src/lib/format.ts` (`formatToman`, `formatNumber`, `toPersianDigits`,
  `formatJalali`, `formatJalaliYear`) — never a Persian numeral literal or an
  ad-hoc `toLocaleString` in a component, or the same screen ends up with two
  different thousands separators.
- **Styling**: Tailwind v4, CSS-first config in `src/app/globals.css`;
  tokens port from `design/src/styles/theme.css`. Merge classes with `cn()`.
  Fonts are **self-hosted** (`src/lib/fonts.ts` → `src/assets/fonts/`) — never
  `next/font/google`, which fetches from Google at build time and fails on
  Iranian infrastructure.
  Storefront and admin are `lang="fa" dir="rtl"` — use logical properties
  (`ms-*`/`me-*`, `start`/`end`), never `left`/`right`.
- **Persian UI copy** in components; identifiers, comments and commits in English.
- Interactive elements carry `data-umami-event="<page>-<element>-<action>"`.
- Conventional commits (commitlint enforces the type list).

## Non-negotiables (from the vault note — these affect code, not just docs)

- **Money is integer Toman** stored as `bigint`. No floats, no decimals; convert
  only at the payment-gateway boundary.
- **Timestamps are UTC `timestamptz`**; render Jalali with
  `Intl.DateTimeFormat('fa-IR', { calendar: 'persian' })` — no date dependency.
- **Products soft-delete** (`is_active`), never hard-delete.
- **Order items snapshot** title/SKU/unit price; shipping fee is snapshotted on
  the order. Orders move through an explicit state machine. Oversell prevention
  is one atomic `UPDATE … WHERE stock >= qty RETURNING`.
- **Payments** are keyed by gateway authority id; verification is server-side and
  idempotent (Zarinpal redirect → callback → verify; no webhooks).
- **Cart is client-side** (localStorage) until checkout; the server re-prices and
  validates at order creation.
- **Rate limits**: every `/api/*` route is budgeted per caller per minute by
  `src/lib/hono/middleware/rate-limit.ts`, mounted **before the first route** —
  Hono runs a wildcard only for routes registered after it, so a later mount
  silently misses the public catalogue and the payment callback. `/api/health`
  and `/api/ready` are exempt. Budgets live in `RATE_LIMITS`; per-order payment
  attempts are capped separately by `MAX_PAYMENT_ATTEMPTS_PER_ORDER`. The caller
  is resolved through `src/lib/auth/client-ip.ts`, the ONE header list Better
  Auth's limiter also reads — `CF-Connecting-IP` is trusted only when
  `APP_CONFIG_TRUST_CF_HEADER` is on, which is safe only behind a locked-down
  origin. `/api/auth/*` is Better Auth's own and is never double-counted.
- **Authz**: admin pages go through `requireAdmin()` (`src/lib/auth/session.ts`)
  — a session alone is never authorization, since customers get sessions too.
  Admin API routes mount `requireAdmin` from `src/lib/hono/middleware/auth.ts`
  (401 without a session, 403 without the role); mount it with `app.use(path,
  requireAdmin)` **before** the route so the guard runs first (the reference is
  `PUT /api/shipping/rates/{provinceId}` in `src/lib/hono/index.ts`).
  Every customer-facing read/write is owner-scoped — take the id from
  `c.get('user')`, never from the URL or the body. `role` defaults to
  `customer` (`ROLES` in `src/db/schema/auth.ts`), is `input: false` everywhere
  a request can reach it, and is granted only by `pnpm create-admin`.
- **Auth is phone OTP, and only phone OTP.** Customers have no passwords and
  neither do admins; the plugin's password endpoints are in `disabledPaths`.
  Phone numbers are stored canonically as `+989xxxxxxxxx`
  (`src/lib/auth/phone.ts`) and the API accepts **nothing else** — clients
  normalize before sending, or one person ends up with two accounts. Any
  `?next=`-style redirect target goes through `safeNextPath`.
- **A correlated subquery's outer reference goes through a nested `sql`
  fragment**, never inlined into the scalar's own template. Drizzle renders
  `${products.id}` unqualified inside a select field, so in `from products fam`
  it binds to `fam.id` and the condition is silently false for every row — green
  on every empty database, wrong on a populated one. `FAMILY_SCOPE` and
  `MEMBER_SCOPE` in `src/db/dao/product-sql.ts` are the pattern, and the
  warning lives beside them; this cost a real bug once.
- **Persian search text** is normalized on write (ي→ی, ك→ک, ZWNJ) + `pg_trgm`.
- **Local-first**: everything must run locally with no third-party signup — SMS
  uses a console driver, uploads use local storage behind the storage interface.
  Hosting is an Iranian PaaS (Docker/plain Node); no Vercel-specific runtime, no
  AWS. S3-compatible object storage arrives later behind the same interface.

## Testing standard

- **Control characters are constructed, never typed (Benyamin, 2026-09-01).**
  When source must reference a control or invisible character (NUL, NBSP, ZWNJ
  as a *target* rather than Persian text, bidi controls), never place the
  literal byte in the file — tooling and reviews cannot see it, and generation
  tools have repeatedly emitted the raw byte where an escape was intended.
  Construct it instead: `'\u0000'` escapes in TS, `String.fromCharCode(0)` in
  tests, `chr(160)` in SQL probes, `U&`-escapes or ARE `\uXXXX` in migrations —
  then byte-verify the file (`cat -v`, `od -c`, or a high-byte grep) before
  committing. Persian content itself is of course written normally.

Every non-trivial function ships with unit tests covering all its aspects: happy
path, edge cases (empty/zero/max, Persian text, boundaries), error paths, invalid
input. Money, order-state and authz logic get exhaustive branch coverage — every
legal and illegal transition, oversell under concurrency, idempotent double
verify, cross-user isolation (IDOR). Tests assert behavior, not implementation; a
story is not done until its tests would fail if its logic broke. Tests sit next
to the code (`foo.test.ts`). Write the failing test first.

Constraints (CHECK, unique, FK) and anything else the database itself enforces
cannot be proven against a mocked `db`, so those suites run against the dev
Postgres (`src/db/test-db.ts`). They skip only when `APP_CONFIG_DATABASE_URL` is
**unset**; if it is set and the server does not answer, the run fails rather
than skipping — a configured-but-down database is a broken environment, not a
green build. Bring it up with
`docker compose --file docker-compose-dev.yaml up --wait`. CI must provide
Postgres and set the variable, or it never exercises these suites at all.
A killed run never reaches its `afterAll` cleanup, so its active `test-…`
fixture products stay behind; vitest's globalSetup (`src/db/test-global-setup.ts`)
and `pnpm seed-catalog` switch off every active `test-…`/`e2e-…` product older
than an hour (`ProductDao.deactivateStaleTestProducts`) — keep those prefixes for
test-made products, and never give a real product one.

### Component tests

Harness: **`@testing-library/react` on the happy-dom environment vitest already
runs** — no second config, no browser mode, no `jsdom`. A `.test.tsx` next to
the component is picked up by `pnpm test` like any other suite. `user-event` and
`jest-dom` are deliberately absent: `fireEvent` plus `expect(input.value)` says
the same thing with two fewer dependencies. Browser mode was rejected as the
wrong size — it buys real layout and a real `<dialog>` at the cost of a browser
download in every CI run, and neither escape below needed either.

A client component MUST get one when its correctness lives in **wiring rather
than in a function**, i.e. no unit test can reach it:

- **Hydration-sensitive wiring** — anything whose first client render has to
  reproduce what the server sent. `useSyncExternalStore`'s server snapshot is
  the type case: `getServerCart`'s own unit test passes against the bug,
  because both candidates return an empty array and only the *choice* is wrong.
- **State-sync mechanisms** — state derived from something this component
  itself causes to change: a prop it writes back, or a platform observer
  watching what it renders. The window where intention and the source of truth
  disagree is where the bug lives, and it exists only at runtime.
- **URL-resync logic** — a control that writes the URL and reads it back.
  Debounces, in-flight navigation, Enter racing a timer.

Copy the pattern from `src/features/storefront/cart/cart-drawer.test.tsx`
(hydration), `src/features/storefront/shop/shop-search.test.tsx` (resync) and
`src/features/storefront/product/product-gallery.test.tsx` (a platform
observer: stub the global, capture the callback it was handed, and deliver the
batch a browser would — every target that crossed, each with its ratio, not
one hand-picked entry).
Four rules those two encode:

- **Verify the pin by reverting the bug.** A component test that still passes
  against the original defect is worth nothing — both escapes here were already
  "covered". Run the revert, watch it fail, restore.
- **Assert React's errors through `onRecoverableError`**, not a `console.error`
  spy. React 19 hands a recoverable error to `reportError` where the environment
  defines it and to `console.error` only otherwise. happy-dom does not define
  `reportError` today, so a spy happens to work — and goes silently blind the
  day happy-dom adds it, or the test runs anywhere that already has it. The
  explicit callback does not depend on that fallback.
- **Fake only the timers the component uses**
  (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`). The full set
  hijacks React's own scheduling and is where flakiness comes from.
- **Mock at the module edge, never the logic under test.** `next/navigation`'s
  `useRouter().push` is a recorder; the test then re-renders with the real
  `parseShopQuery` of the pushed href, so the resync runs for real.

Still browser-verified at review/QA, not here: anything visual or platform —
RTL layout and logical properties, Persian font rendering, the native
`<dialog>`'s focus trap, Escape, backdrop and top-layer stacking (happy-dom
implements `<dialog>` only partly — keep assertions off `showModal()`), the
`body:has(dialog[open])` scroll lock, and real navigation.

No blanket retrofit: components without one of the three properties above are
covered by their pure modules' unit tests plus browser verification.

### End-to-end tests

`pnpm test:e2e` (Playwright, `e2e/`) is the regression walk QA used to do by
hand, run at 1280px and again at 375px. Storefront: phone-OTP sign-in for a
customer and an admin; home → shop → product → cart drawer (quantity, removal,
empty state) and a sold-out product; a both-pets product under either pet
filter and under its sub-category's parent, reading «گربه و سگ» on its page —
each of those shelves also checked for a product it must *not* list; the one
seeded product with a gallery walked at both widths, its last thumbnail — two
slides away, the jump a one-slide test cannot make — opening the photo it
names; a product
in two categories listed once under that parent and once under each of its own,
its breadcrumb naming parent then sub-category and both its categories linked
in the spec row; a product family listed as **one** card reading «از …» with
the cheapest member's price and an «انتخاب» link in place of the add button,
its page headed title — label, its chips carrying the shopper to a sibling's
own slug and the cart line naming that member; checkout by card to card — Jalali date and `format.ts`-formatted numbers
on the result page, the order in `/account` — and through the mock Zarinpal
gateway (paid, and failed → retry → paid). Admin: anonymous visitors and
customers turned away; the dashboard figures; an order shipped, and one
cancelled with its stock coming back; a product added with three photos — for
both pets, filed under a sub-category and given a second category — its
gallery read on the product page (the strip, the numbered later slides, the
first photo as the opening image), then dragged in both directions and
reordered with the arrow keys — the arrow moves leaving focus on the handle
that moved, the second drag marking its tile while it runs and leaving none marked after — and the shopper's
opening photo checked once afterwards (three photos, not two: a drag or a
click that travels only one cell is the single case `scroll-snap-stop: always`
lets through, and dragging toward the *end* is the direction that moves the
tile under the pointer), then two photos removed — the first of them from the
keyboard — whose `uploads/…` files stop
serving while the kept one goes on serving (all probed with `request.get`,
never an `<img>`: `next/image` caches what it optimized, so a deleted file
renders on from `.next/cache`) — repriced, found
under both category filters and taken off the shop; a sub-category nested under
a category the panel then refuses to delete until it is emptied; a product
family's members each listed and named by their own label, the head's
«زیرمجموعه‌ی» select disabled because it has members and a member's live
(read-only, so it runs at both widths and leaves nothing behind); a discount
code a shopper redeems,
then cannot once it is switched off; a shipping rate that checkout then
charges, and one fee applied to every province at once (cancelled at the
confirm, then confirmed) that checkout then charges; a province an admin adds, that checkout and the address book then
offer and, once it is switched off, no longer offer — a saved address on it
flagged in both — until it is switched back on; a home headline that the
storefront then shows. Every page a spec opens is also checked for console
errors, failed requests and requests to any host but the app's own (the `test`
fixture in `e2e/support.ts`). QA runs it instead of re-walking those flows and
drives the browser only for a story's new behaviour.

**Every new feature ships with E2E coverage (Benyamin's standing rule,
2026-09-14).** A story that adds or changes something a shopper or an admin
does adds or updates its spec in `e2e/`, in the same branch, covering the
story's acceptance criteria — and is not done until `pnpm test:e2e` is green
with it. Prove the spec like a component test: put the bug back, watch it
fail, restore. Only a change with no user-facing flow (a helper, a migration,
docs) is exempt.

**Not covered — still walked by hand when a story touches them:** content
areas other than the home headline, a wrong or resent login code, maintenance
mode switched on (the suite pins it off; the gate is unit-tested in
`src/app/(app)/(store)/layout.test.ts`), Zarinpal switched off at checkout (the
suite pins it on; the disabled option is component-tested in
`src/features/checkout/checkout-form.submit.test.tsx`), and anything visual
(RTL layout, Persian font rendering).

- **It starts its own server**: `next dev` on :3100, never a running :3000 —
  that one may be another checkout on another branch. Before it: migrate,
  `seed-catalog` and `seed-shipping`, all idempotent (the seed also puts back
  the stock the specs spend). `webServer.env` pins console SMS with the code on
  the login page, mock Zarinpal switched on (`APP_CONFIG_ZARINPAL_ENABLED`,
  off by default) and local storage, and blanks Sentry, Umami and the S3 image
  base URL over whatever `.env` says. Only the dev Postgres has to
  be up already. Next allows one `next dev` per checkout: if `pnpm dev` is
  running in the same checkout, the suite stops at "Another next dev server is
  already running" — stop that server, or run the suite from a worktree.
- **A worktree has no `.env`**:
  `DOTENV_CONFIG_PATH=<main checkout>/.env pnpm test:e2e`.
- **Sign in once per role, never per test.** `e2e/auth.setup.ts` signs a fresh
  customer and a fresh admin (`pnpm create-admin`) in through the real login
  page and saves their sessions; specs opt in with `test.use({ storageState })`
  (`e2e/support.ts`). send-otp allows 3 a minute for the whole machine, so a run
  started within a minute of the last one waits about a minute.
- **What a run leaves in the dev database:** two throwaway `0999…` accounts, a
  few orders, one inactive `e2e-…` product (it is given three photos and has two
  of them removed again, so one file stays under `uploads/`)
  filed under a seeded sub-category and a seeded second category — seeded, and
  never one the spec made, because the junction's restricting foreign key would
  pin that category for good — one switched-off `E2E…` discount code and one
  inactive «استان آزمایشی …»
  province with the customer's address on it — those three specs run at 1280px
  only, since none of those rows can be deleted. The sub-category spec deletes
  both rows it creates, so it runs at both widths. The card-to-card spec leaves a
  `checkout.payment` content row equal to the default (it puts the old values
  back in a `finally`). The shipping-rate and headline
  specs put the old value back, the one-fee-for-all spec puts every province's
  own fee back (through the API, all attempted before any failure is reported), the province spec switches its province
  off, and the catalog spec switches its product off (through the API), even when they fail.
- **Leaked active test products break shelf pagination.** Shelves list
  newest-first, 12 a page, so a stray active `test-…`/`e2e-…` product pushes a
  seeded one to a later page and a spec that looks for it on page one fails.
  The seed's sweep switches off any older than an hour.
- **Uploaded images never count as failed requests.** A dev database keeps the
  uploads it was given while `.env` pointed at object storage, and this run's
  local driver has no file for them. The catalog spec proves the upload path
  instead: it uploads a photo and checks that it renders.
- **Selectors are the `data-umami-event` names** (roles for headings and
  dialogs). App routes come from `paths.ts`, and the product and province a
  spec uses from the seed data in `src/db/seed/`, never restated. Renaming an
  event is a spec change.
- **Browser: the installed Google Chrome** (`channel: 'chrome'`), no download.
  A failure keeps its trace and screenshot: `pnpm exec playwright show-report`.

## Quality gates — all must pass before a story is done

```bash
pnpm type-check      # tsc --noEmit
pnpm lint            # eslint .
pnpm format:check    # prettier --check ./src  (`pnpm format` writes the fixes)
pnpm test            # vitest run
pnpm test:e2e        # playwright test (dev Postgres up; see End-to-end tests)
pnpm build           # next build
```

A zero exit code is not "clean": deprecation and lint warnings count as failures.

In a checkout with no `.env` — every agent worktree — run the build gate as
`pnpm build:local`, which is also what the pre-push hook runs. It is `next build`
with the Dockerfile's throwaway build-time values (`APP_CONFIG_DATABASE_URL`,
`APP_CONFIG_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`) filled in
for each one that neither the shell nor a `.env` file sets, so real values
always win. Nothing connects to the database or checks the secret while
building, but the URL is inlined into that output: build it to check, never to
deploy. Plain `pnpm build` fills nothing, so a real build without
`NEXT_PUBLIC_APP_URL` still fails.

## Local development

```bash
cp .env.example .env                # fill APP_CONFIG_AUTH_SECRET (openssl rand -hex 32)
pnpm install
pnpm app:dev                        # dev Postgres (Docker) + Next on :3000
pnpm migration:migrate              # first run, in a second terminal
pnpm seed-catalog                   # demo categories + products (safe to re-run)
pnpm seed-shipping                  # 31 provinces + shipping rates (safe to re-run)
pnpm create-admin 09121234567       # grant admin to a phone number
```

`http://localhost:3000` storefront · `/admin-panel` admin panel ·
`/api/reference` interactive API docs (non-production only). Sign-in is `/login`
for customers and admins alike; the console SMS driver prints the one-time code
to the server log, so no SMS account is needed locally.
Other commands: `pnpm drizzle-studio`,
`pnpm migration:reset-dev` (nuke volumes, re-migrate), `pnpm --dir design dev`
(design prototype).
Running `next dev` on any port but 3000 needs `NEXT_PUBLIC_APP_URL` overridden
in the shell to match, or Better Auth rejects every POST with 403.

Agent worktrees have no `.env` of their own: build there with
`pnpm build:local` (see Quality gates), and give the database-backed tests the
main checkout's with `DOTENV_CONFIG_PATH=<main checkout>/.env pnpm test`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
