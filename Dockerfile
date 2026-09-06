# Multi-stage build for the Next 16 standalone output (`output: 'standalone'` in
# next.config.ts). Three stages — deps → build → runtime — so the shipped image
# is a slim Node 24 runtime carrying only the standalone server, its traced
# node_modules, the static assets and public/. No source, no dev deps, no pnpm.
#
# All runtime configuration is env-only (see docs/DEPLOY.md) EXCEPT
# NEXT_PUBLIC_APP_URL, which Next inlines into the client bundle at build time —
# so it is a build ARG here, not a container env var. Pass the real https origin:
#   docker build --build-arg NEXT_PUBLIC_APP_URL=https://shop.example.com .
# The default below is a placeholder that only makes local builds boot.

# ─────────────────────────────────────────────────────────────────────────────
# deps — install the full dependency set (incl. dev deps) for the build stage.
# NODE_ENV is deliberately NOT production here: pnpm would then skip devDeps and
# `next build` would fail.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# HUSKY=0 disables the `prepare: husky` git hook install — .git is not in the
# build context, so husky would otherwise error. It is the documented CI escape.
ENV HUSKY=0
RUN corepack enable

# Only the manifests, so this layer caches until dependencies actually change.
# pnpm-workspace.yaml carries `overrides` + `allowBuilds` + `enablePrePostScripts`
# — omitting it silently changes resolution and skips native builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# build — compile the app into .next/standalone.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_APP_URL is inlined into the client bundle now — must be the real
# origin at build time (drives the Secure cookie flag + CSRF trusted origins).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

# Build the standalone output. The three vars are set inline for this command
# only — they never become image ENV metadata (nothing sensitive is baked in;
# also why BuildKit's secret-in-ENV check stays quiet). The DB/secret values are
# throwaway placeholders that only satisfy the required-var checks in
# src/lib/utils/env.ts while Next imports the auth/db modules: `new Pool()` does
# not connect, nothing here verifies the secret, and every data route is
# force-dynamic so no DB-backed page is rendered at build.
RUN NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
    APP_CONFIG_DATABASE_URL="postgres://build:build@127.0.0.1:5432/build" \
    APP_CONFIG_AUTH_SECRET="build-time-placeholder-not-used-at-runtime" \
    pnpm build

# ─────────────────────────────────────────────────────────────────────────────
# runtime — the shipped image. Slim, non-root, env-only.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone server defaults HOSTNAME to localhost in some builds, which binds
# loopback only and is unreachable through `-p`. Bind all interfaces explicitly.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# `node` is a non-root user the base image already provides — no need to create one.
# Pre-create the local-storage upload root owned by that user: a Coolify volume
# mounted here would otherwise be root-owned and uploads would fail at runtime.
# Keep APP_CONFIG_STORAGE_LOCAL_ROOT pointed at this path (see docs/DEPLOY.md).
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# The standalone output already contains a minimal, traced node_modules + server.js.
# static/ and public/ are not part of it and must be copied alongside.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
