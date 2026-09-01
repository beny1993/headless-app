# Smokey Shop

Persian (RTL) pet-shop e-commerce for Iran — Toman pricing, Jalali dates, phone
OTP sign-in, Zarinpal and cash on delivery.

**Stack**: Next.js 16 (App Router, React 19) · TypeScript strict · Hono
(`@hono/zod-openapi` + Scalar) · PostgreSQL + Drizzle · Better Auth ·
Tailwind CSS v4 · React Email · Vitest · pnpm 11 / Node 24 · Docker.

## Quick start

```bash
cp .env.example .env                # fill APP_CONFIG_AUTH_SECRET (openssl rand -hex 32)
pnpm install
pnpm app:dev                        # dev Postgres + Next on http://localhost:3000
pnpm migration:migrate              # first run, second terminal
pnpm create-admin 09121234567       # provision (or promote) an admin by phone
```

| URL | What |
| --- | --- |
| `http://localhost:3000` | Storefront |
| `http://localhost:3000/admin-panel` | Admin panel (email OTP, invite-only) |
| `http://localhost:3000/api/reference` | Interactive API docs (non-production) |

`design/` holds the vendored design prototype the front-end ports from —
`pnpm --dir design install && pnpm --dir design dev` (http://localhost:5173).

Conventions, architecture and quality gates: **[AGENTS.md](./AGENTS.md)**.
