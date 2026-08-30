# Smokey Shop — design prototype

The Figma Make export, vendored and corrected. **This is the design reference the FE
stories port from** — not the production app. Original Figma file:
<https://www.figma.com/design/9HOHop6CYyUz1w8Xt6ahlU/Start-Working-on-Project>

Everything lives in `src/app/App.tsx`; the design tokens are in `src/styles/theme.css`.

## Running

```sh
pnpm install
pnpm dev      # http://localhost:5173
```

Zero external requests: the Vazirmatn font and every photo are bundled locally
(see `ATTRIBUTIONS.md`).

## Routes

Hash routing exists so every screen is reachable for review. The port replaces it
with App Router paths.

| Hash | Screen |
| --- | --- |
| `#/home` | Home |
| `#/shop` | Shop (filters, search, empty-results state) |
| `#/product/1` … `#/product/8` | Product detail (`#/product/5` is the out-of-stock state, `#/product/8` low stock) |
| `#/about` | About |
| `#/login` | Phone OTP — code `۱۱۱۱۱۱` triggers the wrong-code error state |
| `#/checkout` | Checkout (auth-gated; empty cart is guarded) |
| `#/result/success` · `#/result/failed` · `#/result/pending` | Payment result — one page, three order states |
| `#/account` | Account (orders, pets, addresses, profile) |
| `#/account/orders/10040` | Customer order detail (this one is `pending_payment`, so it shows the retry CTA) |
| `#/admin-panel` | Admin panel — in the app this is a role-gated `/admin` route, never linked from the storefront |
| `#/admin-panel/orders/10045` | Admin order detail (try `10040`/`10044`/`10043`/`10042` for the other transition states) |
| `#/admin-panel/products/new` · `#/admin-panel/products/1` | Product create / edit form |
| `#/admin-panel/settings` | Shipping rates — 31 provinces, editable fee |

## What is deliberately not here

Dark mode (cut in v1), the magazine/blog, reviews and wishlist (backlog), and the
newsletter (cut). Everything else in `Design Review - Figma Export` is designed;
the remaining items in that note are porting-time concerns (skeletons, API-failure
states, pagination, price-range filter).
