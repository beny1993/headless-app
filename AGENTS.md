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
| `src/lib/seo.ts` | What search engines read: root metadata, `absoluteUrl` (every canonical, sitemap `<loc>` and JSON-LD link), site JSON-LD, breadcrumbs, sitemap entries. Canonicals belong on pages: a layout's `alternates.canonical` makes every page without its own claim to be that one. The rest of SEO, each file headed by its own rules: `src/app/sitemap.ts` + `src/logic/seo/stocked-shelves.ts`, `src/features/storefront/product/product-seo.ts` + `shop-policy.ts`, `src/features/storefront/shop/shop-metadata.ts`, `src/components/json-ld.tsx` |
| `src/lib/sentry.ts` | The one `Sentry.init` options object, shared by all three runtimes (`register()` in `src/instrumentation.ts` for Node and edge, `src/instrumentation-client.ts` for the browser). Owns the privacy contract: explicit `dataCollection` opt-outs and the removal of the console-breadcrumb integration, without which every OTP in the server log rides along on the next event |
| `src/lib/content/` | Storefront editorial content: the client-safe zod schemas + key enum + area map + `isVisible` (`site-content.ts`), the saved-link contract + `resolveLink` (`link.ts`; its id → slug targets load in `src/logic/content/link-targets.ts`), the typed defaults + `resolveContent` fallback (`defaults.ts`), and the header/footer request-time read `readSiteChrome` (`chrome.ts`, `await connection()`). Values live in the `site_content` table; the page-organized admin editor is `/admin-panel/content/[area]` |
| `src/features/<area>/<feature>/` | Feature components; route files stay thin |
| `src/hooks/` | Shared client hooks (`@/hooks`). `use-modal-dialog.ts` is the one wiring for every native modal `<dialog>` — mobile menu, cart drawer, shop filter sheet. `use-drag-reorder.ts` is the one drag-to-reorder — the product gallery's photos and the content editor's category picks: the pointer gesture carried by `window` listeners, the RTL arrow keys, focus following the moved handle and one polite live region, each trap documented beside its code |
| `src/lib/catalog/variant.ts` | Product families: `displayTitle` (the **single** derivation used by the product heading, the admin list and the `order_items` snapshot), the label cap and the Persian refusals. A family is `products.variant_of` + `variant_label` — a member is an ordinary product row, so the cart, the stock decrement and `order_items` are untouched; the storefront lists `variant_of is null` and reaches members from the head's page |
| `design/` | **Canonical design reference** — vendored Figma prototype (own deps, own `pnpm dev` on :5173). FE stories port from it. Never imported by the app. |
| `scripts/create-admin.ts` | Grant admin by phone (`pnpm create-admin <phone> [name]`) — creates or promotes |
| `src/db/seed/`, `scripts/seed-catalog.ts` | Demo catalog seed (`pnpm seed-catalog`), idempotent; its images live in `public/products/`, plus the hygiene tile's `public/site/cat-hygiene.jpg` |
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
  A migration's journal `when` must be newer than every entry before it: the
  runtime migrator silently skips an older-dated one, so a merge conflict in
  `meta/_journal.json` is resolved by regenerating, never by renumbering with
  the old `when` (`src/db/migrations/journal.test.ts` pins the order).
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
- **Route paths**: import from `src/lib/constant/paths.ts`.
- **Persian display formatting**: every number, price and date goes through
  `src/lib/format.ts` (`formatToman`, `formatNumber`, `toPersianDigits`,
  `formatJalali`, `formatJalaliYear`) — never a Persian numeral literal or an
  ad-hoc `toLocaleString` in a component, or the same screen ends up with two
  different thousands separators.
- **Styling**: Tailwind v4, CSS-first config in `src/app/globals.css`;
  tokens port from `design/src/styles/theme.css`. Merge classes with `cn()`.
  Fonts are **self-hosted** with `next/font/local` (`src/lib/fonts.ts` →
  `src/assets/fonts/`); `next/font/google` fetches from Google at build time
  and fails on Iranian infrastructure.
  Storefront and admin are `lang="fa" dir="rtl"` — use logical properties
  (`ms-*`/`me-*`, `start`/`end`), never `left`/`right`.
- **Persian UI copy** in components; identifiers, comments and commits in English.
- Interactive elements carry `data-umami-event="<page>-<element>-<action>"`,
  sent by `src/components/umami-tracker.tsx`. Umami's auto-track stays off: it
  cancels the click on every tracked `<a>` and reloads the page itself. The
  name is read off the nearest link or button, else the element clicked, never
  a container's (`trackedEventOf`). So it goes on the `<a>` or `<button>`
  whenever a tap can land inside one; on the form control itself when a
  `<label>` wraps or points at it, since the label forwards its click there;
  otherwise on the exact element tapped.
- Conventional commits (commitlint enforces the type list).

## Non-negotiables (from the vault note — these affect code, not just docs)

- **Money is integer Toman** stored as `bigint`. No floats, no decimals; convert
  only at the payment-gateway boundary — and in Google's structured data, which
  needs ISO 4217 `IRR` because Toman has no code: `rialForStructuredData` in
  `src/lib/seo.ts`, display-only and never a gateway amount.
- **Timestamps are UTC `timestamptz`**; render Jalali with
  `Intl.DateTimeFormat('fa-IR', { calendar: 'persian' })` — no date dependency.
- **Products soft-delete** (`is_active`), never hard-delete.
- **Order items snapshot** title/SKU/unit price; shipping fee is snapshotted on
  the order. Orders move through an explicit state machine. Oversell prevention
  is one atomic `UPDATE … WHERE stock >= qty RETURNING`.
- **Payments** are keyed by gateway authority id; verification is server-side and
  idempotent (Zarinpal redirect → callback → verify; no webhooks).
- **Card to card waits for its receipt.** A card-to-card order is born
  `awaiting_receipt`; its first receipt accepts it into `processing`
  (`src/logic/orders/receipts.ts`, under the order's row lock), and the admins'
  new-order SMS goes out then, never at the create. The checkout locks
  «ثبت سفارش» until the transfer's screenshot is attached and uploads it right
  after the create, so a placed order is accepted at once; waiting is the
  fallback for a screenshot that failed to store, and both shopper pages then
  say the order is not accepted yet. Once the create has answered 2xx nothing
  re-enables «ثبت سفارش» or mints another Idempotency-Key — every failure
  lands on that order's own page
  (`src/features/checkout/checkout-form.receipt.test.tsx`). The admin checks
  the receipt and ships, or cancels — every admin cancel carries a reason the
  shopper reads. The payment row still flips to `paid` only at delivery.
- **A receipt is never public.** Receipts live under `receipts/` in the same
  storage as the photos, and no URL exists for one: `imageSrc` and every
  driver's `url()` throw on a receipt key. The only readers are the
  authenticated routes (the order's owner, 404 to any other customer; an
  admin), answering `private, no-store`; render one with a plain `<img>` on
  that route, never `next/image`. On s3 the bucket's anonymous read must be
  narrowed to `uploads/` (a bucket policy, docs/DEPLOY.md §3) before the
  feature ships: until then every receipt upload answers 503, because the
  driver probes each receipt it stores and finds it public — and every
  card-to-card checkout ends on the not-accepted page.
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
and `pnpm seed-catalog` switch off every active `test-…`/`e2e-…` product not
updated for an hour (`ProductDao.deactivateStaleTestProducts`) — keep those
prefixes for test-made products, and never give a real product one.

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

`pnpm test:e2e` (Playwright, `e2e/`) is the core-flow regression walk, run at
1280px and again at 375px.

**Every new feature ships with E2E coverage (Benyamin's standing rule,
2026-09-14).** A story that adds or changes something a shopper or an admin
does adds or updates its spec in `e2e/`, in the same branch, covering the
story's acceptance criteria — and is not done until `pnpm test:e2e` is green
with it. Prove the spec like a component test: put the bug back, watch it
fail, restore. Only a change with no user-facing flow (a helper, a migration,
docs) is exempt.

- **A worktree has no `.env`**:
  `DOTENV_CONFIG_PATH=<main checkout>/.env pnpm test:e2e`.
- **Stop only the server you started (Benyamin, 2026-09-29).** A QA or cleanup
  step ends a dev server by the PID it launched (or `lsof -ti :<its port>`),
  never by pattern — `pkill -f next-server` also kills every other worktree's
  server, and on 2026-09-29 it took down a parallel session's E2E run mid-suite.

**Read [`e2e/README.md`](e2e/README.md)** before writing or changing a spec,
running the suite, chasing a red or flaky run, or cleaning up what a run
leaves in the dev database. It also lists the flows the suite does not
cover, which QA walks by hand when a story touches them.

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
