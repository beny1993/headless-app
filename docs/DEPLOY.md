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
`.env`.** Set these in Coolify's app → _Environment Variables_.

### Runtime (set in Coolify, plain env)

| Variable                          | Required                                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_CONFIG_DATABASE_URL`         | yes                                           | Postgres connection string. Comes from the Coolify Postgres service (see §2). Use the **internal** service URL, not a public one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `APP_CONFIG_AUTH_SECRET`          | yes                                           | Better Auth signing secret. Generate once with `openssl rand -hex 32`; rotating it invalidates all sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `APP_CONFIG_SMS_PROVIDER`         | yes                                           | OTP SMS driver. `console` (default) logs codes to the server log — **fine for a soft launch, not for real customers**. Set to `smsir` before launch (see §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `APP_CONFIG_SMSIR_API_KEY`        | when `=smsir`                                 | SMS.ir web-service key, sent as `x-api-key`. A **secret** — Coolify env only, never a build arg.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `APP_CONFIG_SMSIR_TEMPLATE_ID`    | when `=smsir`                                 | Numeric id of the SMS.ir panel template the code is substituted into. Its body must contain `#OTP#`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID` | for order alerts                           | Numeric id of the **second** panel template: the new-order SMS every admin with a phone number gets. Its body must contain `#ORDER#`, `#AMOUNT#` and `#METHOD#`. Read only on that send — unset, sign-in is unaffected and only the alert fails, into Sentry.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `APP_CONFIG_SHOW_OTP_IN_UI`       | on staging                                    | `true` prints the OTP on the login page. **Required on a staging deploy:** outside development the `console` driver logs only _that_ a code was sent, never the code and never the number, so `docker logs` no longer carries it. Anything else is off, and it is ignored unless `APP_CONFIG_SMS_PROVIDER=console`. Never set it on the production app — it is a sign-in bypass.                                                                                                                                                                                                                                                                                 |
| `APP_CONFIG_MAINTENANCE_MODE`     | no                                            | `true` shows every storefront page as the maintenance screen to everyone but a signed-in admin, who sees the real site. `/login` and `/admin-panel` stay open. Anything else is off. Restart after changing it — no rebuild. Hides the shop, does not lock it: `/api` stays reachable.                                                                                                                                                                                                                                                                                                                                                                           |
| `APP_CONFIG_ZARINPAL_PROVIDER`    | yes                                           | `mock` (default) simulates the full pay flow with no gateway account. Set to `zarinpal` at the real-gateway flip (see §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `APP_CONFIG_ZARINPAL_MERCHANT_ID` | when `=zarinpal`                              | Merchant UUID from the Zarinpal panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `APP_CONFIG_ZARINPAL_SANDBOX`     | no                                            | `true` routes the real driver at Zarinpal's sandbox host. Default `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `APP_CONFIG_ZARINPAL_ALLOW_MOCK`  | on staging, **if online payment is on there** | `true` declares that this deploy is _meant_ to run the simulated gateway. Every container is a production build, so `APP_CONFIG_ZARINPAL_PROVIDER=mock` **with `APP_CONFIG_ZARINPAL_ENABLED=true`** makes `GET /api/ready` answer **503** and the container never takes traffic (§6). With online payment switched **off**, readiness does not refuse — a shop that cannot take an online payment cannot settle a zero-Toman one — so a card-to-card-only deploy needs nothing here. The money path refuses either way. Anything but `true` is off. **Never set it on the production app**: it would disarm the guard for the day online payment is switched on. |
| `APP_CONFIG_STORAGE_PROVIDER`     | yes                                           | `local` (default) stores uploads on disk (needs a persistent volume, §3). `s3` uses the Liara/Arvan S3-compatible driver — built and verifiable with `pnpm verify-s3`; needs the four `LIARA_*` vars plus build-time `NEXT_PUBLIC_STORAGE_BASE_URL`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `APP_CONFIG_STORAGE_LOCAL_ROOT`   | with `local`                                  | Absolute path the `local` driver writes to. Set to **`/app/uploads`** and mount the volume there (§3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`NODE_ENV=production` is baked into the runtime image — do not override it.

### Build-time (Coolify: enable the "Build Variable" / build-time toggle)

| Variable                         | Required | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`            | yes      | The real `https://` origin, no trailing slash (e.g. `https://shop.example.com`). **Inlined into the client bundle at build time** — it is a Docker build ARG, so it must be marked _available at build time_ in Coolify, not just a runtime var. It drives the `Secure` session-cookie flag and Better Auth's CSRF trusted-origins list; `getAppBaseUrl()` throws in production if unset. A change here requires a **rebuild**, not just a restart. |
| `NEXT_PUBLIC_SENTRY_DSN`         | no       | GlitchTip DSN. **Production app only** — leave it unset on staging, which then reports nothing (decision 2026-09-15). **Build-time only** — it is inlined into both the client _and_ the server bundles, so setting it as a plain runtime variable does nothing at all. Empty ⇒ Sentry is off everywhere. A change needs a **rebuild**. See §9.                                                                                                     |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | no       | `production`. Tags each event with the deployment it came from. Set on the production app alone — staging has no DSN, so it has nothing to tag. Build-time, like the DSN.                                                                                                                                                                                                                                                                           |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL`   | no       | Tracker URL on our self-hosted Umami, `https://analytics.bendev.ir/script.js`. **Production app only** — leave it unset on staging. **Build-time only** — inlined into the client bundle, so a runtime-only variable does nothing.                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID`   | no       | Website id from the Umami dashboard. **Production app only** — staging leaves both Umami vars unset, so it ships no tracker and its traffic never lands in the real numbers. Either this or the script URL empty ⇒ no tracker at all. Build-time; a change needs a **rebuild**.                                                                                                                                                                     |

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
- In Coolify → app → _Storages_, add a **persistent volume mounted at `/app/uploads`**.
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
6. **Health check:** point Coolify's health check at **`GET /api/ready`** — it
   answers only when the process is up AND Postgres is reachable and migrated.
   (There is deliberately no Dockerfile `HEALTHCHECK`; Coolify owns it.)

   > **Corrected 2026-09-19.** This step used to say `/api/health`, on the
   > reasoning that liveness is what a health check wants. That is wrong _here_,
   > and it silently disables the rollback §5 promises: `/api/health` touches no
   > database, so a container whose migration failed still answers it and still
   > turns healthy — Coolify would then retire the old container and serve the
   > broken one. §5 already assumes `/api/ready`. **Check what the Coolify
   > health check is actually set to before the next deploy**; if it is
   > `/api/health`, the migration-failure rollback has never been armed.
   > `GET /api/health` stays available for an uptime pinger that should not
   > depend on the database.

   Both paths are exempt from the `/api/*` rate limiter (`rateLimitGroupFor` in
   `src/lib/hono/middleware/rate-limit.ts`) — a throttled probe would mark the
   container unhealthy and roll a perfectly good deploy back.

---

## 5. Database migrations on deploy

Migrations are **Drizzle SQL files** in `src/db/migrations/`. The image applies
them itself, **every time a container starts**, before the server does — its
`CMD` is `node scripts/migrate.mjs && exec node server.js`. `scripts/migrate.mjs`
is a plain-Node applier (drizzle-orm's `migrate()`; the slim runtime image has no
`drizzle-kit`) that reads `src/db/migrations/meta/_journal.json` and applies only
what is outstanding, so a restart with nothing pending is a no-op.

Nothing is configured in Coolify for this. One deploy ships a migration _and_
applies it, in the container that is about to serve:

- **A migration fails** (or the database is unreachable): the script exits
  non-zero, the server never starts, the new container never turns healthy, and
  Coolify rolls back — the old container keeps serving and the deploy is marked
  failed. Pending migrations run in one transaction, so a failed or interrupted
  run leaves the schema as it was.
- **A slow migration**: the new container has to answer `/api/ready` inside the
  healthcheck window (start period + interval × retries, ~35 s as configured).
  For a migration that needs longer, raise the _start period_ for that deploy,
  or the deploy fails although nothing is wrong.
- **One replica.** Two containers starting at once would both try to migrate;
  take a `pg_advisory_lock` in `scripts/migrate.mjs` before scaling out.

> **Remove Coolify's pre-deployment command** (`node scripts/migrate.mjs`) if it
> is still set. Coolify runs it with `docker exec` in the container that is
> _already running_, before the new commit is cloned — so it applied the
> **previous** image's migrations, and a new migration only landed on the deploy
> _after_ the one that shipped it. Left in place it is a harmless no-op.

Migrations up to `0011` are additive. The old container keeps serving while the
new one migrates, so a **destructive** migration still needs the compatible
two-step: expand → deploy → contract.

**`0012` is the first one that is not additive** — it rewrites
`products.pet_type` from an enum to an enum array, in place. Its `USING` clause
is hand-written and the file says so at the top: drizzle-kit's generated cast
fails on a populated table, so regenerating this migration does not reproduce
it. From the moment the
new container has migrated until Coolify swaps it in (its healthcheck window,
~35 s as configured), the old container is talking to the new column: its
`?pet=` listings answer 500 (there is no `pet_type[] = pet_type` operator) and an
admin product save is refused — both fail closed, nothing is written wrong. It
ships as one step on purpose — the window is seconds — so for that deploy:

- **Dump `products (id, pet_type, category_id)` first** — off-box database
  backups are still open on the Docker-deploy story, and this is the one column
  this release cannot reconstruct.
- **Deploy when nobody is editing products**, and do not raise the start period
  for it: the gap is the outage.

**Going back.** Rolling the image back does not roll the column back, and the
previous image cannot read `pet_type[]` at all — so a rollback without this is
a shop whose every `?pet=` listing answers 500. Against the same database,
before the old image starts:

```sql
-- The reverse of 0012. Keeps the FIRST pet of a both-pets product; the dump
-- above is the only thing that can say which rows those were.
ALTER TABLE products DROP CONSTRAINT products_pet_type_not_empty;
ALTER TABLE products ALTER COLUMN pet_type TYPE pet_type USING pet_type[1];
```

And put it back by hand before deploying forward again — **the migration
runner will not do it for you.** `drizzle-kit migrate` applies whatever is
newer than the newest row in `drizzle.__drizzle_migrations`, and that row is
still `0016`, so `0012` is behind the mark and never re-runs:

```sql
ALTER TABLE products ALTER COLUMN pet_type TYPE pet_type[] USING ARRAY[pet_type];
ALTER TABLE products
  ADD CONSTRAINT products_pet_type_not_empty CHECK (cardinality(pet_type) >= 1);
```

`0013`–`0016` need none of this: new nullable columns, indexes, and CHECKs that
only constrain writes the old code never makes. `0012` is the one migration in
this release that a rollback has to undo.

The `build` target (source, dev deps, `drizzle-kit`) is still the tool for one-off
jobs against a deployed database — the seed steps below:

```bash
# On the VPS (or CI), against the same DATABASE_URL the app uses:
docker build --target build -t smokey-shop:migrate .
```

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

`seed-catalog` is demo data — skip it on a real production store.

`seed-shipping` is no longer needed on a deploy: migration `0011_seed_provinces`
plants the 31 provinces and their placeholder fees wherever migrations run. It
only adds what is missing — a province already typed in by hand keeps its name,
fee and active flag, and is recognised even when spelled with different spacing
or a ZWNJ. Then set the real fees in the admin panel: one fee for every province
with «اعمال روی همه استان‌ها», and the exceptions row by row.

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
      so it cannot be forged _through_ Cloudflare — but a request that reaches
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
- [ ] **Maintenance mode off:** `APP_CONFIG_MAINTENANCE_MODE` unset (or
      anything but `true`) on the production app, then restart — otherwise
      launch day shows every customer «به‌زودی برمی‌گردیم».
- [ ] **Real SMS driver:** set `APP_CONFIG_SMS_PROVIDER=smsir` plus
      `APP_CONFIG_SMSIR_API_KEY` and `APP_CONFIG_SMSIR_TEMPLATE_ID`. The
      `console` default sends nothing at all (and, outside development, does not
      even log the code). The driver posts to
      SMS.ir's **verify** service (`/v1/send/verify`), which is where OTP is
      routed — the bulk/line-number API is for marketing sends and carriers
      filter codes on it. Create the template in the SMS.ir panel first: its
      body must contain `#OTP#`, and the driver sends that parameter as `OTP`.
      A missing or malformed key/template does **not** fail the deploy — the
      driver is built when a code is sent, so it fails the first login instead.
      Run `pnpm verify-sms <phone>` with the production values before switching.
      If the SMS.ir panel's IP restriction is on, list the server's outbound
      IPv4 (app → Terminal in Coolify: `wget -qO- https://api.ipify.org`), plus
      the IP of whatever machine runs `verify-sms`; anything unlisted is refused.
- [ ] **New-order admin alert:** create the **second** SMS.ir panel template
      (body with `#ORDER#`, `#AMOUNT#` and `#METHOD#`) and set
      `APP_CONFIG_SMSIR_ORDER_TEMPLATE_ID`. Every admin holding the `admin`
      role who has a phone number then gets one SMS per order, so
      `pnpm create-admin` is what puts someone on that list. Unset, the
      driver still signs people in and only the alert fails, into Sentry.
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

### Before deploying the forbidden-character widening (once, on production)

The bidi marks (U+200E, U+200F, U+061C) and the two separators (U+2028, U+2029)
are now refused on write, and the shared text validators behind checkout, pets,
the address book and site content enforce the class for the first time. A row
saved with one of those characters **before** this deploy keeps rendering, but
every later edit of it fails with «نویسه‌های نامعتبر» — and the
character is invisible, so there is nothing for the admin to see and delete. A
price change on such a product is blocked until someone retypes its title.

Run this first; it reads nothing but `id` and the offending value. **The target
characters are built as `U&` escapes, never typed** (the control-character rule):
a literal mark in a runbook is invisible to whoever copies it.

```sql
with bidi as (select U&'[\061C\200E\200F\2028\2029\202A-\202E\2066-\2069]' as p)
select 'products.title'        as field, p.id::text as id, p.title          as value from products p, bidi b where p.title          ~ b.p
union all select 'products.brand',          p.id::text, p.brand          from products p, bidi b where p.brand          ~ b.p
union all select 'products.benefit',        p.id::text, p.benefit        from products p, bidi b where p.benefit        ~ b.p
union all select 'products.description',    p.id::text, p.description    from products p, bidi b where p.description    ~ b.p
union all select 'products.variant_label',  p.id::text, p.variant_label  from products p, bidi b where p.variant_label  ~ b.p
union all select 'categories.title',        c.id::text, c.title          from categories c, bidi b where c.title        ~ b.p
union all select 'site_content.value',      s.key,      s.value::text    from site_content s, bidi b where s.value::text ~ b.p
union all select 'pets.name',               t.id::text, t.name           from pets t, bidi b where t.name               ~ b.p
union all select 'addresses.recipient_name', a.id::text, a.recipient_name from addresses a, bidi b where a.recipient_name ~ b.p
union all select 'addresses.address_line',  a.id::text, a.address_line   from addresses a, bidi b where a.address_line   ~ b.p;
```

ZWNJ (U+200C) is deliberately **not** in the pattern, so ordinary Persian
titles never match it — only the reordering characters do.

Empty result — nothing to do. Any rows: retype the value (an admin for the
first three, the customer for the last two) before or just after the deploy.
`provinces` is safe, because the old schema normalized the mark away on write.
`orders` and `order_items` are safe too: they are snapshots, never re-validated
and never edited, so a mark there stays as a rendering oddity on one historical
order and blocks nothing.

### Staging prerequisites (a staging deploy is a production build)

Staging runs the same image as production — `NODE_ENV=production` — on the mock
gateway and the console SMS driver, and both of those fail closed. Set both
variables on the staging app, or the next staging deploy is unusable:

- [ ] **`APP_CONFIG_ZARINPAL_ALLOW_MOCK=true`** — needed only if staging has
      `APP_CONFIG_ZARINPAL_ENABLED=true`. With online payment switched on and
      the provider left on `mock`, the container comes up dead: `GET /api/ready`
      answers 503 and Coolify never routes to it. With it switched off,
      readiness does not refuse and this variable is unnecessary — a shop that
      cannot take an online payment cannot settle a zero-Toman one.
      **Never set it on production.** It would disarm the guard for the one
      deploy that matters: the day online payment is switched on and the
      provider is still `mock`. Set `APP_CONFIG_ZARINPAL_PROVIDER=zarinpal`
      with a merchant id there instead. Production's own deploy on 2026-09-22
      rolled back on this refusal while card-to-card only — the reason the
      guard now reads the switch.
- [ ] **`APP_CONFIG_SHOW_OTP_IN_UI=true`** — without it nobody can sign in: the
      console driver no longer writes the code or the number to the log.
- [ ] **Confirm the Coolify health check is `GET /api/ready`**, not
      `/api/health` — §6 above has been carrying that correction since
      2026-09-19 and it may still be unfixed. Pointed at `/api/health`, the
      mock-gateway 503 is never observed, and §5's migration-failure rollback
      was never armed either. The money path still fails closed regardless:
      `getZarinpalClient()` throws on the first checkout, so nothing settles
      — the probe is what turns that into "no traffic" instead of "one broken
      shopper".

Neither variable belongs on the production app. Production sets a real provider
and a real SMS driver, which is what makes both unnecessary there.

**What `APP_CONFIG_SHOW_OTP_IN_UI=true` costs on staging.** It is now _required_
there, because the log fallback is gone — and it makes
`POST /api/auth/phone-number/send-otp` hand the code back in its own response to
whoever asked. Anyone who can reach staging can send a code for a known admin
number and read it back: one request, admin session. The 3-per-minute throttle
does not stop a single targeted attempt, and it never did. Production is
strictly safer after this change; staging is strictly less safe. **So staging
must not be publicly routable** — put it behind the Cloudflare origin lockdown
([[Story - Cloudflare Origin Lockdown]]) or behind basic auth before this ships.
Treat every staging admin account as compromised-by-design: never reuse a
production phone number or session there.

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

| Host                                                             |                 |                                                      |
| ---------------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| `app.glitchtip.com/api/<id>/envelope/`                           | **405**         | ingest alive (405 = "POST me") — **what we use**     |
| `us.i.posthog.com/i/v0/e/`, `us-assets.i.posthog.com`            | 400 / 200       | reachable; EU region is not                          |
| `cloud.umami.is`                                                 | 200             |                                                      |
| `notify.bugsnag.com`, `api.honeybadger.io`, `api.axiom.co`       | 405 / 301 / 404 | reachable alternatives                               |
| `downloads.sentry-cdn.com`                                       | 200             | sentry-cli binary — not blocked                      |
| `registry.npmjs.org`                                             | 200             |                                                      |
| `ghcr.io`, `registry-1.docker.io`                                | 401             | normal unauth reply — a prebuilt image can be pulled |
| **`sentry.io`**                                                  | **403**         | blocked                                              |
| **`eu.posthog.com`, `api.rollbar.com`, `otlp.eu01.nr-data.net`** | **403**         | blocked                                              |
| **`in.logs.betterstack.com`, `api.telegram.org`**                | **timeout**     | blocked                                              |

Note the egress IP is **not stable** — `api.ipify.org`, `ipinfo.io` and
`icanhazip.com` each reported a different address (Liara NATs through a pool).
Anything that needs an IP allow-list is therefore not an option here.

### Configuration

`NEXT_PUBLIC_SENTRY_DSN` holds the **GlitchTip** DSN; the variable keeps its name
because the SDK reads it. Both it and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` are
**build-time** (§1) — they are inlined into the client _and_ server bundles, so a
runtime-only value does nothing. Both are set on the **production** app only;
staging leaves them empty and reports nothing (decision 2026-09-15), so the
project only ever shows customer-facing errors.

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
standard). CI is the natural home for the seed release step in §5.
