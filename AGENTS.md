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
| `src/app/(admin)/` | Back office: `auth/(public)` sign-in, `(protected)` pages behind `requireAdmin()` |
| `src/app/api/[[...route]]/` | Hono catch-all; Better Auth at `src/app/api/auth/[...all]/` |
| `src/db/schema/`, `src/db/dao/`, `src/db/migrations/` | Drizzle schema, DAOs, generated migrations |
| `src/lib/hono/` | API app, router factory, response envelope, routes |
| `src/lib/auth/`, `src/lib/email/`, `src/lib/utils/env.ts` | Better Auth, mailer, env accessor |
| `src/features/<area>/<feature>/` | Feature components; route files stay thin |
| `design/` | **Canonical design reference** — vendored Figma prototype (own deps, own `pnpm dev` on :5173). FE stories port from it. Never imported by the app. |
| `scripts/create-admin.ts` | Provision an admin (`pnpm create-admin <email> [name]`) |

## Conventions

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
  Admin API routes need the same check server-side; there is no admin API yet.
  Every customer-facing read/write is owner-scoped. `role` defaults to
  `customer` (`ROLES` in `src/db/schema/auth.ts`) — admin is granted only by
  `pnpm create-admin`.
- **Persian search text** is normalized on write (ي→ی, ك→ک, ZWNJ) + `pg_trgm`.
- **Local-first**: everything must run locally with no third-party signup — SMS
  uses a console driver, uploads use local storage behind the storage interface.
  Hosting is an Iranian PaaS (Docker/plain Node); no Vercel-specific runtime, no
  AWS. S3-compatible object storage arrives later behind the same interface.

## Testing standard

Every non-trivial function ships with unit tests covering all its aspects: happy
path, edge cases (empty/zero/max, Persian text, boundaries), error paths, invalid
input. Money, order-state and authz logic get exhaustive branch coverage — every
legal and illegal transition, oversell under concurrency, idempotent double
verify, cross-user isolation (IDOR). Tests assert behavior, not implementation; a
story is not done until its tests would fail if its logic broke. Tests sit next
to the code (`foo.test.ts`). Write the failing test first.

## Quality gates — all must pass before a story is done

```bash
pnpm type-check      # tsc --noEmit
pnpm lint            # eslint .
pnpm format:check    # prettier --check ./src  (`pnpm format` writes the fixes)
pnpm test            # vitest run
pnpm build           # next build
```

A zero exit code is not "clean": deprecation and lint warnings count as failures.

## Local development

```bash
cp .env.example .env                # fill APP_CONFIG_AUTH_SECRET (openssl rand -hex 32)
pnpm install
pnpm app:dev                        # dev Postgres (Docker) + Next on :3000
pnpm migration:migrate              # first run, in a second terminal
pnpm create-admin you@example.com   # provision an admin
```

`http://localhost:3000` storefront · `/backoffice` back office ·
`/api/reference` interactive API docs (non-production only). Back-office sign-in
prints the OTP and a magic link to the server console in development — no SMTP
needed. Other commands: `pnpm dev:email` (email preview), `pnpm drizzle-studio`,
`pnpm migration:reset-dev` (nuke volumes, re-migrate), `pnpm --dir design dev`
(design prototype).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
