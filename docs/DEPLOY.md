# Deploy runbook — Smokey Shop on VPS + Coolify

Hosting is a **self-managed VPS running [Coolify](https://coolify.io)** (decision
2026-09-05, supersedes the managed Liara/Arvan pick). Coolify builds this repo's
`Dockerfile` from Git, provisions Postgres, terminates TLS (Let's Encrypt), runs
the reverse proxy, and mounts persistent volumes. The app itself is a plain
Node/Docker target — nothing here is Coolify-specific except the control-plane
steps, so it ports to any Docker host.

> **VPS location is still open** and matters: an **Iran-hosted VPS** is strongly
> preferred (reachable from Iran without a VPN, low latency, Rial billing). A
> cheap foreign box (Hetzner/Contabo) reintroduces the Iran-IP block + latency +
> sanctions-signup problems that got Vercel rejected. Decide before buying.

The image is built by Coolify **on the VPS**, so the production image is the
VPS's architecture. The locally-verified image (see below) is `linux/arm64` on
an Apple-Silicon Mac — do **not** push that local image to prod; let Coolify
build from Git.

---

## 1. Environment variables

All runtime configuration is env-only. Names come from the `VARS` enum in
`src/lib/utils/env.ts`; the annotated template is `.env.example`. **Never commit
`.env`.** Set these in Coolify's app → *Environment Variables*.

### Runtime (set in Coolify, plain env)

| Variable | Required | What it is |
| --- | --- | --- |
| `APP_CONFIG_DATABASE_URL` | yes | Postgres connection string. Comes from the Coolify Postgres service (see §2). Use the **internal** service URL, not a public one. |
| `APP_CONFIG_AUTH_SECRET` | yes | Better Auth signing secret. Generate once with `openssl rand -hex 32`; rotating it invalidates all sessions. |
| `APP_CONFIG_SMS_PROVIDER` | yes | OTP SMS driver. `console` (default) logs codes to the server log — **fine for a soft launch, not for real customers**. Set to `smsir` before launch (see §6). |
| `APP_CONFIG_SMSIR_API_KEY` | when `=smsir` | SMS.ir web-service key, sent as `x-api-key`. A **secret** — Coolify env only, never a build arg. |
| `APP_CONFIG_SMSIR_TEMPLATE_ID` | when `=smsir` | Numeric id of the SMS.ir panel template the code is substituted into. Its body must contain `#CODE#`. |
| `APP_CONFIG_SHOW_OTP_IN_UI` | no | `true` prints the OTP on the login page for **staging/QA only**, where `console` codes reach nothing but the server log. Anything else is off, and it is ignored unless `APP_CONFIG_SMS_PROVIDER=console`. Never set it on the production app — it is a sign-in bypass. |
| `APP_CONFIG_ZARINPAL_PROVIDER` | yes | `mock` (default) simulates the full pay flow with no gateway account. Set to `zarinpal` at the real-gateway flip (see §6). |
| `APP_CONFIG_ZARINPAL_MERCHANT_ID` | when `=zarinpal` | Merchant UUID from the Zarinpal panel. |
| `APP_CONFIG_ZARINPAL_SANDBOX` | no | `true` routes the real driver at Zarinpal's sandbox host. Default `false`. |
| `APP_CONFIG_STORAGE_PROVIDER` | yes | `local` (default) stores uploads on disk (needs a persistent volume, §3). `s3` uses the Liara/Arvan S3-compatible driver — built and verifiable with `pnpm verify-s3`; needs the four `LIARA_*` vars plus build-time `NEXT_PUBLIC_STORAGE_BASE_URL`. |
| `APP_CONFIG_STORAGE_LOCAL_ROOT` | with `local` | Absolute path the `local` driver writes to. Set to **`/app/uploads`** and mount the volume there (§3). |
| `APP_CONFIG_EMAIL_ENABLED` | no | `false` (default) logs emails to the console. `true` sends over SMTP and requires the five SMTP vars below. |
| `APP_CONFIG_SMTP_SERVER` | when email on | SMTP host. |
| `APP_CONFIG_SMTP_PORT` | when email on | `465` = implicit TLS, `587` = STARTTLS. |
| `APP_CONFIG_SMTP_USER` | when email on | SMTP username. |
| `APP_CONFIG_SMTP_PASSWORD` | when email on | SMTP password. |
| `APP_CONFIG_SMTP_SENDER_EMAIL` | when email on | From address. |

`NODE_ENV=production` is baked into the runtime image — do not override it.

### Build-time (Coolify: enable the "Build Variable" / build-time toggle)

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | The real `https://` origin, no trailing slash (e.g. `https://shop.example.com`). **Inlined into the client bundle at build time** — it is a Docker build ARG, so it must be marked *available at build time* in Coolify, not just a runtime var. It drives the `Secure` session-cookie flag and Better Auth's CSRF trusted-origins list; `getAppBaseUrl()` throws in production if unset. A change here requires a **rebuild**, not just a restart. |
| `NEXT_PUBLIC_SENTRY_DSN` | no | Sentry DSN. **Build-time only** — it is inlined into both the client *and* the server bundles, so setting it as a plain runtime variable does nothing at all. Empty ⇒ Sentry is off everywhere. A change needs a **rebuild**. See §9. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | no | `staging` or `production`. Both apps report into one Sentry project; without this, staging noise is indistinguishable from customer-facing errors. Build-time, like the DSN. |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | no | Tracker URL on our self-hosted Umami, `https://analytics.bendev.ir/script.js`. **Build-time only** — inlined into the client bundle, so a runtime-only variable does nothing. |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | no | Website id from the Umami dashboard. **Use a different website for staging than for production**, or staging traffic lands in the real numbers. Either this or the script URL empty ⇒ no tracker at all. Build-time; a change needs a **rebuild**. |

**Not needed in Coolify** — these are consumed only by `docker-compose-dev.yaml`
for the local dev database and have no role in production:
`APP_CONFIG_DATABASE_USERNAME`, `APP_CONFIG_DATABASE_PASSWORD`,
`APP_CONFIG_DATABASE_NAME`, `APP_CONFIG_DATABASE_PORT`.

---

## 2. Postgres

1. In the Coolify project, add a **PostgreSQL** service (v17 matches dev).
2. Coolify generates the credentials and an internal connection URL — copy it
   into `APP_CONFIG_DATABASE_URL` on the app. Keep it on the internal network;
   do not expose Postgres publicly.
3. The schema uses `pg_trgm` (`CREATE EXTENSION`). Coolify's Postgres is a stock
   container where this works — no managed-PaaS extension allow-list to fight.
   The extension is created by a migration, so no manual step is needed.
4. **Backups must target an off-box bucket** (e.g. Arvan object storage), never
   the same VPS — this is real order/customer data. Configure Coolify's
   scheduled DB backup to that remote destination.

---

## 3. Storage (product image uploads)

**Launch option — `local` driver on a persistent volume (no extra service):**

- Set `APP_CONFIG_STORAGE_PROVIDER=local` and `APP_CONFIG_STORAGE_LOCAL_ROOT=/app/uploads`.
- In Coolify → app → *Storages*, add a **persistent volume mounted at `/app/uploads`**.
  The image pre-creates that directory owned by the non-root `node` user (uid
  1000), so the app can write to it. Without the volume, uploads live in the
  container's writable layer and are **lost on every redeploy**.
- The image's `chown` only takes effect for a Docker **named volume** on first
  mount. If Coolify is configured to back the storage with a **host-directory
  bind mount**, that directory is root-owned and uploads fail silently — `chown
  1000:1000` the host directory on the VPS once before first deploy.

**Production option — `s3` driver (Liara/Arvan):** the S3-compatible driver is
built. Set the four `LIARA_*` vars as runtime secrets, set
`NEXT_PUBLIC_STORAGE_BASE_URL` = `${LIARA_ENDPOINT}/${LIARA_BUCKET_NAME}` as a
**build** variable, flip `APP_CONFIG_STORAGE_PROVIDER=s3`, and set the bucket to
public object-read (no listing). Prove it with `pnpm verify-s3` before trusting
it — it round-trips a real object through the live bucket. Uploads then survive a
redeploy with no persistent volume. The storage seam means nothing else changes.

---

## 4. Create the app in Coolify

1. New Resource → **Application** → this Git repository, branch `main`.
2. Build pack: **Dockerfile** (the repo root `Dockerfile`). Coolify auto-detects it.
3. Set the env vars from §1 (remember the build-time toggle on `NEXT_PUBLIC_APP_URL`).
4. Attach the Postgres service (§2) and the uploads volume (§3).
5. Networking: assign the domain, let Coolify issue the Let's Encrypt cert (TLS
   is terminated at Coolify's proxy). The app listens on port **3000** inside the
   container (`EXPOSE 3000`, `HOSTNAME=0.0.0.0`).
6. **Health check:** point Coolify's health check at **`GET /api/health`** — it
   returns `{"status":"success","data":{"status":"ok",...}}` and touches no DB,
   so it reports process liveness, not database reachability. (There is
   deliberately no Dockerfile `HEALTHCHECK`; Coolify owns it.)

---

## 5. Database migrations on deploy

Migrations are **Drizzle SQL files** in `src/db/migrations/`, applied by
`drizzle-kit migrate` (`pnpm migration:migrate`), which reads
`src/db/migrations/meta/_journal.json` and applies only what's outstanding
(idempotent — safe to re-run).

**The slim runtime image does not contain `drizzle-kit`** (it's a devDependency),
so Coolify's *pre-deployment command* — which runs inside that runtime image —
**cannot** run migrations. Run them as a **separate release step** using the
Dockerfile's `build` target, which already carries the source, dev deps,
drizzle-kit and the migration files:

```bash
# On the VPS (or CI), against the same DATABASE_URL the app uses:
docker build --target build -t smokey-shop:migrate .
docker run --rm -e APP_CONFIG_DATABASE_URL="$APP_CONFIG_DATABASE_URL" \
  smokey-shop:migrate pnpm migration:migrate
```

Order: **migrate before the new image goes live.** All migrations so far are
additive, so run-then-deploy is safe; if a future migration is destructive,
gate it behind a compatible two-step (expand → deploy → contract).

> Follow-up for the PM: if a Coolify-native pre-deploy is wanted, ship a small
> programmatic migrator (drizzle-orm's `migrate()` + the migrations folder) in
> the runtime image so migrations can run in-image without drizzle-kit. Out of
> this story's box-independent scope.

### Seed steps (first deploy only, from the `build`/`migrate` image)

Both scripts are idempotent (safe to re-run):

```bash
docker run --rm -e APP_CONFIG_DATABASE_URL="$APP_CONFIG_DATABASE_URL" \
  smokey-shop:migrate pnpm seed-shipping      # 31 provinces + placeholder rates
docker run --rm -e APP_CONFIG_DATABASE_URL="$APP_CONFIG_DATABASE_URL" \
  smokey-shop:migrate pnpm seed-catalog       # demo categories + products
# Grant the first admin by phone (creates or promotes):
docker run --rm -e APP_CONFIG_DATABASE_URL="$APP_CONFIG_DATABASE_URL" \
  smokey-shop:migrate pnpm create-admin 09121234567 "Admin Name"
```

`seed-catalog` is demo data — skip it on a real production store; `seed-shipping`
is real infrastructure (you then tune the per-province fees in the admin panel).

---

## 6. Pre-launch checklist (from the auth security pass, 2026-09-02)

Do these **at deploy, before real customers** — they are box-/decision-dependent
and deliberately not baked into the image:

- [ ] **`NEXT_PUBLIC_APP_URL`** = the real `https://` origin, set as a **build
      variable** (§1). Confirm it's the real host, not the placeholder — rebuild
      after changing it.
- [ ] **Lock the origin to Cloudflare.** The domain is Cloudflare-proxied, so
      `src/lib/auth/index.ts` resolves the client IP from `CF-Connecting-IP`
      (`advanced.ipAddress.ipAddressHeaders`) — without it Better Auth's IP rate
      limiter buckets every visitor together. Cloudflare overwrites that header,
      so it cannot be forged *through* Cloudflare — but a request that reaches
      the VPS **directly** carries whatever header it likes, and a fresh forged
      value per request mints a fresh rate-limit bucket each time. So the origin
      must refuse non-Cloudflare traffic: allow 443 only from
      [Cloudflare's published ranges](https://www.cloudflare.com/ips/), or use a
      Cloudflare Tunnel so the origin has no public port at all. Until then the
      IP axis is bypassable; the per-phone `otp_send_log` throttle still bounds
      the SMS bill.
      **Verify after deploy:** hit the site through the domain and confirm
      `rate_limit` rows key on real visitor IPs — not one repeated Cloudflare
      edge address, and not the literal `no-trusted-ip`. Note that the
      "could not determine a client IP" warning does **not** fire in the
      Cloudflare-edge case, so log-grepping alone will not catch it.
- [ ] **Real SMS driver:** set `APP_CONFIG_SMS_PROVIDER=smsir` plus
      `APP_CONFIG_SMSIR_API_KEY` and `APP_CONFIG_SMSIR_TEMPLATE_ID`. The
      `console` default logs every OTP to the server log. The driver posts to
      SMS.ir's **verify** service (`/v1/send/verify`), which is where OTP is
      routed — the bulk/line-number API is for marketing sends and carriers
      filter codes on it. Create the template in the SMS.ir panel first: its
      body must contain `#CODE#`, and the driver sends that parameter as `CODE`.
      A missing or malformed key/template does **not** fail the deploy — the
      driver is built when a code is sent, so it fails the first login instead.
      Run `pnpm verify-sms <phone>` with the production values before switching.
      If the SMS.ir panel's IP restriction is on, list the server's outbound
      IPv4 (app → Terminal in Coolify: `wget -qO- https://api.ipify.org`), plus
      the IP of whatever machine runs `verify-sms`; anything unlisted is refused.
- [ ] **`APP_CONFIG_SHOW_OTP_IN_UI` unset (or `false`) on production.** Staging
      sets it to `true` to read codes off the login page; production must not,
      and the real SMS driver above also disarms it.
- [ ] **Email-era users** (`phone_number` NULL) cannot sign in (email login is
      removed), and `pnpm create-admin <their-phone>` mints a **new** row beside
      the dormant one — reconcile or accept per the data state before launch.
- [ ] **No Iran-blocked runtime deps:** fonts are self-hosted (`src/lib/fonts.ts`,
      never `next/font/google`), images/assets are bundled or on the uploads
      volume, telemetry is disabled (`NEXT_TELEMETRY_DISABLED=1` in the image).
      Verify against the deployed site.

### Zarinpal real-driver flip (only when going live on the real gateway)

Set `APP_CONFIG_ZARINPAL_PROVIDER=zarinpal` + `APP_CONFIG_ZARINPAL_MERCHANT_ID`.
Two LOW money-safety fixes must land **with** the flip (they encode live v4 codes
unverifiable without creds — see `Story - Zarinpal Payment Integration`):
delete the client-`Status`-trusting NOK branch in `handleCallback`
(`src/logic/payments/verify.ts`); route amount-mismatch to manual review instead
of expire+restock.

---

## 7. Known launch gates (decisions, not code in this story)

Two filed gates from the discount-codes security pass (2026-09-06). Both are
**benign under the shipped mocks** and bite only at the real-gateway flip or via
abuse; the fixes belong to the payments / reconcile stories, not here.

1. **Zero-total order + real Zarinpal → 500 + stuck order (LOW–MEDIUM).** A
   100%/subtotal-covering discount + a zero-fee province + `paymentMethod:
   zarinpal` makes `total == 0` reachable; the real driver throws on the
   sub-minimum amount, stranding the order in `pending_payment` holding stock and
   a consumed discount. **Decision at flip:** auto-settle a zero-total order as
   paid without calling the gateway, **or** forbid `zarinpal` when `total == 0`
   (force COD). `MAX_OPEN_ORDERS=5` bounds the blast radius meanwhile.
2. **Discount-use drain via COD-then-cancel (LOW, money-safe).** COD checkout is
   uncapped and a discount use is never released on cancel/expiry, so one account
   can burn a limit-N promo with COD orders then cancel. **Decision:** release the
   use on cancel (reconcile/expiry story), or add a COD cap.

---

## 9. Error monitoring — GlitchTip, not Sentry

The app is instrumented with **`@sentry/nextjs`**, but the backend is
**GlitchTip Cloud** (`app.glitchtip.com`). GlitchTip implements the Sentry
envelope protocol, so the SDK, every `captureException` call site and the whole
privacy contract in `src/lib/sentry.ts` are unchanged — only the DSN differs.

**Why not Sentry:** sentry.io refuses Iranian IPs. Measured from this box:

```bash
curl -sI https://o<org>.ingest.us.sentry.io/api/<project>/envelope/
# HTTP/2 403 — "Your client does not have permission to get URL ..."
```

That is the Google front-end sanctions block on the egress path, not an account
problem — the same request from a non-Iranian IP returns Sentry's normal `401`.
Shoppers' browsers are refused for the same reason, so `tunnelRoute` does not
rescue it either: it proxies browser events through this server, which is itself
blocked. GlitchTip has none of that problem.

### Reachability from this box (measured 2026-09-08)

| Host | | |
| --- | --- | --- |
| `app.glitchtip.com/api/<id>/envelope/` | **405** | ingest alive (405 = "POST me") — **what we use** |
| `us.i.posthog.com/i/v0/e/`, `us-assets.i.posthog.com` | 400 / 200 | reachable; EU region is not |
| `cloud.umami.is` | 200 | |
| `notify.bugsnag.com`, `api.honeybadger.io`, `api.axiom.co` | 405 / 301 / 404 | reachable alternatives |
| `downloads.sentry-cdn.com` | 200 | sentry-cli binary — not blocked |
| `registry.npmjs.org` | 200 | |
| `ghcr.io`, `registry-1.docker.io` | 401 | normal unauth reply — a prebuilt image can be pulled |
| **`sentry.io`** | **403** | blocked |
| **`eu.posthog.com`, `api.rollbar.com`, `otlp.eu01.nr-data.net`** | **403** | blocked |
| **`in.logs.betterstack.com`, `api.telegram.org`** | **timeout** | blocked |

Note the egress IP is **not stable** — `api.ipify.org`, `ipinfo.io` and
`icanhazip.com` each reported a different address (Liara NATs through a pool).
Anything that needs an IP allow-list is therefore not an option here.

### Configuration

`NEXT_PUBLIC_SENTRY_DSN` holds the **GlitchTip** DSN; the variable keeps its name
because the SDK reads it. Both it and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` are
**build-time** (§1) — they are inlined into the client *and* server bundles, so a
runtime-only value does nothing.

**Tracing is off** (no `tracesSampleRate` in `src/lib/sentry.ts`). GlitchTip's
performance support is partial, and transactions are the high-volume signal —
enabling them spends a shared event quota on data nobody reads. Errors are the
point.

**Source maps** are still off: `next.config.ts` gates upload, release creation
and plugin telemetry on `SENTRY_AUTH_TOKEN`, and `@sentry/cli`'s postinstall is
skipped in `pnpm-workspace.yaml`. Neither is now blocked by the network —
`downloads.sentry-cdn.com` answers 200 and GlitchTip accepts sentry-cli uploads —
so turning both on is a real option whenever minified production stack traces
start costing more than the setup does.

---

## 8. CI note

There is no CI workflow in the repo today. When one is added, it **must** set
`APP_CONFIG_DATABASE_URL` and provide a Postgres service, or the DB-backed
integration suites silently skip (they skip only when the variable is unset; a
configured-but-down DB fails the run instead — see `CLAUDE.md` › Testing
standard). CI is the natural home for the migrate/seed release step in §5.
