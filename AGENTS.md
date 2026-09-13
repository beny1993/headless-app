# Smokey Shop — agent guide

Persian (RTL) pet-shop e-commerce for Iran. Prices in Toman, Jalali dates,
phone-OTP customers, Zarinpal + cash on delivery. This file is the repo's source
of truth for agents; `CLAUDE.md` is a symlink to it.

Planning lives in the Obsidian vault: `Projects/smokey shop/` — board
`Smokey Shop Plan`, facts `Smokey Shop Info`, stories in `stories/`. One story =
one branch. Read the story note before touching code.

## Stack

Next 16 App Router (React 19, TypeScript strict) · Hono `@hono/zod-openapi` +
Scalar mounted at `/api/[[...route]]` · Postgres + Drizzle (schema / DAO /
migrations) · Better Auth · Tailwind v4 + shadcn-style primitives · React Email +
nodemailer · Vitest · ESLint 9 + Prettier · husky + lint-staged + commitlint ·
pnpm 11 / Node 24 · Docker for dev Postgres.

No CMS. The commerce schema is ours, in Drizzle; the admin panel is a custom
`/admin` area built from the design prototype.

## Layout

| Path | What |
| --- | --- |
| `src/app/(app)/` | Public storefront (own root layout + `globals.css`) |
| `src/app/(admin-panel)/` | Admin panel: `(protected)` pages behind `requireAdmin()`. Sign-in is the storefront's `/login` — there is one login for the whole site |
| `src/app/api/[[...route]]/` | Hono catch-all; Better Auth at `src/app/api/auth/[...all]/` |
| `src/db/schema/`, `src/db/dao/`, `src/db/migrations/` | Drizzle schema, DAOs, generated migrations |
| `src/lib/hono/` | API app, router factory, response envelope, routes |
| `src/lib/auth/`, `src/lib/email/`, `src/lib/utils/env.ts` | Better Auth, mailer, env accessor |
| `src/lib/sentry.ts` | The one `Sentry.init` options object, shared by all three runtimes (`sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts`). Owns the privacy contract: explicit `dataCollection` opt-outs and the removal of the console-breadcrumb integration, without which every OTP in the server log rides along on the next event |
| `src/lib/content/` | Storefront editorial content: the client-safe zod schemas + key enum + area map + `isVisible` (`site-content.ts`), the typed defaults + `resolveContent` fallback (`defaults.ts`), and the header/footer request-time read `readSiteChrome` (`chrome.ts`, `await connection()`). Values live in the `site_content` table; the page-organized admin editor is `/admin-panel/content/[area]` |
| `src/features/<area>/<feature>/` | Feature components; route files stay thin |
| `design/` | **Canonical design reference** — vendored Figma prototype (own deps, own `pnpm dev` on :5173). FE stories port from it. Never imported by the app. |
| `scripts/create-admin.ts` | Grant admin by phone (`pnpm create-admin <phone> [name]`) — creates or promotes |
| `src/db/seed/`, `scripts/seed-catalog.ts` | Demo catalog seed (`pnpm seed-catalog`), idempotent; its images live in `public/products/` |
| `scripts/seed-shipping.ts` | Seed all 31 provinces + placeholder shipping rates (`pnpm seed-shipping`), idempotent (upserts by name, never resets a tuned fee) |
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
  `{ status: 'error', message, errors? }` (`src/lib/hono/envelope.ts`). Consume
  with `getData`/`postData` from `src/lib/api-client.ts`.
- **Env vars**: names live in the `VARS` enum in `src/lib/utils/env.ts`, template
  in `.env.example`. `NEXT_PUBLIC_*` must also be listed in `STATIC_INLINED_VARS`
  there. Never commit `.env`.
- **Route paths**: import from `src/lib/constant/paths.ts`; never hardcode.
- **Persian display formatting**: every number, price and date goes through
  `src/lib/format.ts` (`formatToman`, `formatNumber`, `toPersianDigits`,
  `formatJalali`, `formatJalaliYear`) — never a Persian numeral literal or an
  ad-hoc `toLocaleString` in a component, or the same screen ends up with two
  different thousands separators.
- **Styling**: Tailwind v4, CSS-first config in `src/app/(app)/globals.css`;
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
- **State-sync mechanisms** — state derived from a prop that this component
  itself causes to change. The window where intention and prop disagree is
  where the bug lives, and it exists only at runtime.
- **URL-resync logic** — a control that writes the URL and reads it back.
  Debounces, in-flight navigation, Enter racing a timer.

Copy the pattern from `src/features/storefront/cart/cart-drawer.test.tsx`
(hydration) and `src/features/storefront/shop/shop-search.test.tsx` (resync).
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
empty state) and a sold-out product; checkout by cash on delivery — Jalali date
and `format.ts`-formatted numbers on the result page, the order in `/account` —
and through the mock Zarinpal gateway (paid, and failed → retry → paid). Admin:
anonymous visitors and customers turned away; the dashboard figures; an order
shipped, and one cancelled with its stock coming back; a product added with a
photo, repriced and taken off the shop; a discount code a shopper redeems,
then cannot once it is switched off; a shipping rate that checkout then
charges; a home headline that the storefront then shows. Every page a spec
opens is also checked for console errors, failed requests and requests to any
host but the app's own (the `test` fixture in `e2e/support.ts`). QA runs it
instead of re-walking those flows and drives the browser only for a story's new
behaviour.

**Every new feature ships with E2E coverage (Benyamin's standing rule,
2026-09-14).** A story that adds or changes something a shopper or an admin
does adds or updates its spec in `e2e/`, in the same branch, covering the
story's acceptance criteria — and is not done until `pnpm test:e2e` is green
with it. Prove the spec like a component test: put the bug back, watch it
fail, restore. Only a change with no user-facing flow (a helper, a migration,
docs) is exempt.

**Not covered — still walked by hand when a story touches them:** content
areas other than the home headline, a wrong or resent login code, and anything
visual (RTL layout, Persian font rendering).

- **It starts its own server**: `next dev` on :3100, never a running :3000 —
  that one may be another checkout on another branch. Before it: migrate,
  `seed-catalog` and `seed-shipping`, all idempotent (the seed also puts back
  the stock the specs spend). `webServer.env` pins console SMS with the code on
  the login page, mock Zarinpal and local storage, and blanks Sentry, Umami and
  the S3 image base URL over whatever `.env` says. Only the dev Postgres has to
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
  few orders, one inactive `e2e-…` product (its photo stays under `uploads/`)
  and one switched-off `E2E…` discount code — those two specs run at 1280px
  only, since neither row can be deleted. The shipping-rate and headline specs
  put the old value back, even when they fail.
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
Other commands: `pnpm dev:email` (email preview), `pnpm drizzle-studio`,
`pnpm migration:reset-dev` (nuke volumes, re-migrate), `pnpm --dir design dev`
(design prototype).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
