# End-to-end tests

The Playwright suite (`pnpm test:e2e`, Playwright config in `playwright.config.ts`). The standing rules — every feature ships E2E coverage, worktree `.env`, stop only the server you started — live in `AGENTS.md` under _End-to-end tests_; this file is the rest.

## What it covers

`pnpm test:e2e` (Playwright, `e2e/`) is the regression walk QA used to do by
hand, run at 1280px and again at 375px. Storefront: phone-OTP sign-in for a
customer and an admin; home → shop → product → cart drawer (quantity, removal,
empty state) and a sold-out product; the sort control stepped through all
three orderings on the sold-out product's pet shelf, every in-stock card
listed before any sold-out one, and «فقط محصولات موجود» hiding it there
until its chip is removed; the home page's category mosaic with no
empty cell and its tall tiles two rows tall (three at 1280px, two at 375px); a
both-pets product under either pet
filter and under its sub-category's parent, reading «گربه و سگ» on its page —
each of those shelves also checked for a product it must _not_ list; the one
seeded product with a gallery walked at both widths, its last thumbnail — two
slides away, the jump a one-slide test cannot make — opening the photo it
names; a product
in two categories listed once under that parent and once under each of its own,
its breadcrumb naming parent then sub-category and both its categories linked
in the spec row; a product family listed as **one** card reading «از …» with
the cheapest **in-stock** member's price (its head is seeded sold out and
cheaper) and an «انتخاب» link in place of the add button that opens that
member rather than the sold-out head, its page headed title — label, the
head's chip reading «ناموجود», its chips carrying the shopper to a sibling's
own slug and the cart line naming that member; checkout by card to card —
«ثبت سفارش» locked until the transfer's screenshot is attached, the checkout
page free of ASCII digits once it is, the order accepted on landing
(«سفارش ثبت شد!», «در حال پردازش», the receipt's thumbnail rendered with its
Jalali upload time), Jalali date and `format.ts`-formatted numbers on the
result page, the receipt's URL answering the shopper 200 `private, no-store`
and a request with no session exactly 401 (both probed with `request.get`),
the order in `/account` reading «در حال پردازش», both order pages showing
only the receipt — no upload box, no card numbers — and the line's product
photo; a screenshot whose upload is cut keeping the shopper on the checkout,
where «ارسال دوباره رسید» resends it to the same order, then accepted; a
reload of that retry landing on `/checkout?resume=` for the same order,
whose screenshot then accepts it; a waiting order the shopper cancels from
their account, its stock coming back — and through the mock Zarinpal gateway (paid, and failed → retry →
paid). Admin: anonymous visitors and
customers turned away; the dashboard figures; an order whose receipt the admin
sees before shipping it; one whose screenshot upload the spec cuts with
`page.route` — the checkout staying with «ارسال دوباره رسید», its result page
(reached by «مشاهده سفارش») saying it is not accepted yet, never
«سفارش ثبت شد!», and the account order page saying so too, neither offering an
upload or the card numbers — cancelled while still waiting, with a reason, and
its stock coming back; an accepted one cancelled with a reason the
shopper then reads on their order page, no upload box left and the stock
back; a product added with three photos — for
both pets, filed under a sub-category and given a second category — its
gallery read on the product page (the strip, the numbered later slides, the
first photo as the opening image), then dragged in both directions and
reordered with the arrow keys — the arrow moves leaving focus on the handle
that moved, the second drag marking its tile while it runs and leaving none marked after — and the shopper's
opening photo checked once afterwards (three photos, not two: a drag or a
click that travels only one cell is the single case `scroll-snap-stop: always`
lets through, and dragging toward the _end_ is the direction that moves the
tile under the pointer), then two photos removed — the first of them from the
keyboard — whose `uploads/…` files stop
serving while the kept one goes on serving (all probed with `request.get`,
never an `<img>`: `next/image` caches what it optimized, so a deleted file
renders on from `.next-e2e/dev/cache/images`) — repriced, found
under both category filters, then deleted from the list through its
confirmation modal (cancelled once first, sending nothing): gone from the list,
its page 404 and its last photo's file no longer served; a product a shopper
orders, whose modal then names the orders and offers only «غیرفعال», the row
staying inactive with no 🗑 left; a sub-category nested under
a category the panel then refuses to delete until it is emptied; a category
created, renamed and deleted, its shop shelf read right after each save —
there under its title, renamed, then 404 — since each save drops the
storefront's cached category list; a category
given a photo that its home-page tile then shows (the file probed with
`request.get`), a new one picked in its edit row that the tile then follows,
and a plain tile once the photo is removed; a photo picked through the button
in the list's last row — below the fold, so `main` has scrolled — with the
panel frame still filling the screen (read-only, so both widths); a product
family's members each listed and named by their own label, the head's
«زیرمجموعه‌ی» select disabled because it has members and a member's live
(read-only, so it runs at both widths and leaves nothing behind); a discount
code a shopper redeems,
then cannot once it is switched off; a shipping rate that checkout then
charges, and one fee applied to every province at once (a dot-grouped
`25.000` refused at the field before any confirm, then cancelled at the
confirm, then confirmed) that checkout then charges; a province an admin adds, that checkout and the address book then
offer and, once it is switched off, no longer offer — a saved address on it
flagged in both — until it is switched back on; a home headline that the
storefront then shows; a product the home grid already shows, picked for the
first «انتخاب‌های اسموکی» box — the seeded family offered by its head's row and
never a member's (matched by id) — that the grid then shows first and only
there, every other box still filled; home categories an admin picks in the
content editor, leading the strip in the order picked, and two more dragged
into the opposite order — by mouse at 1280px, by a finger through Chrome's own
touch input at 375px, where the grip's `touch-none` is all that keeps the drag
from turning into a scroll — the grip's row marked while the gesture runs and
none after, the arrow keys leaving focus on the grip that moved, then listed
so by the reopened editor and led with by the strip; the users area — its two
customer counts formatted, the new-this-month one read again, the same, off the
dashboard's tile, the run's customer on the first page, a search by the number
they typed (`0999…`, stored `+98…`) listing exactly their row, their account
page, with the sidebar's «کاربران» lit on both, opening one of their orders,
whose «مشاهده حساب سفارش‌دهنده» leads back to that same account — and
anonymous visitors and customers turned away from the list and a detail page.
How pages arrive (`streaming.spec.ts`): the shop's
HTML with its heading ahead of the first card and the grid's skeleton in the
page, a real 404 carrying no skeleton for an unknown category, the phone filter
sheet's count agreeing with the toolbar once the listing is in, and the
account and admin panel skeletons in their pages' HTML.
For search engines: `sitemap.xml` listing a seeded
product, a family member and their shelves by the URL each page names as its
canonical; a product page's `Product` JSON-LD priced in Rial, with its Google
product category, shipping and return policy — those terms also shown on the
page — and its breadcrumb, both in the HTML the server sends; the home page's
canonical, share card and `Organization`; a category shelf named by its category in the
tab, its heading and its share card, its breadcrumb leading back to the whole
shop with the slashes hidden from screen readers; a sorted view of it (still
described by its shelf), a search and a page past the end kept out of the
index with no canonical; and the about page's canonical and share card. Every
page a spec opens is also checked for console errors, failed requests and requests to any host but the app's own (the `test`
fixture in `e2e/support.ts`). QA runs it instead of re-walking those flows and
drives the browser only for a story's new behaviour.

## Running it

- **It starts its own server**: `next dev` on :3100, never a running :3000 —
  that one may be another checkout on another branch. Worktrees running the
  suite at the same time each pick their own with `E2E_PORT=3101 pnpm test:e2e`
  (validated in `playwright.config.ts`; :3100 when unset). Before it: migrate,
  `seed-catalog` and `seed-shipping`, all idempotent (the seed also puts back
  the stock the specs spend). `webServer.env` pins console SMS with the code on
  the login page, mock Zarinpal switched on (`APP_CONFIG_ZARINPAL_ENABLED`,
  off by default) and local storage, and blanks Sentry, Umami and the S3 image
  base URL over whatever `.env` says. Only the dev Postgres has to
  be up already.
- **Its server builds into `.next-e2e`**, a folder of its own, with Turbopack's
  dev cache off (`E2E_SERVER` in `webServer.env`, read by `next.config.ts`). So
  it runs beside a `pnpm dev` in the same checkout, sharing its source tree: an
  edit made mid-run changes what the suite tests. And it cannot start on a
  stale cache, which on 16.4 reloaded a page over and over until the spec on it
  timed out; every route compiles cold instead. Still one run per checkout: a
  second, even on another `E2E_PORT`, stops at "Another next dev server is
  already running" (the lock is per build folder), so parallel suites run from
  worktrees. After a run, `next-env.d.ts` imports `.next-e2e`'s route types
  until `pnpm dev` or a build rewrites it, so deleting `.next-e2e` by hand
  breaks `pnpm type-check` until one of them runs, as deleting `.next` does.
- **Checkout is rate-capped per account** (`MAX_ORDERS_PER_WINDOW` in
  `src/logic/checkout/create-order.ts`, 30 orders an hour, any status). One
  run's throwaway customer places 28 across both viewports (`checkout` 12,
  `courier` 2, `admin` 8, `admin-users` 2, `admin-settings` 2, `admin-catalog` 2 at 1280px
  only), so a spec that adds checkouts eats into that headroom — raise the
  constant before the suite trips it with a 422 mid-run.
- **A card-to-card order is open until its receipt arrives.** The open-order
  cap (`MAX_OPEN_ORDERS`, five per account) counts `awaiting_receipt` as well
  as `pending_payment`. `completeCheckout` attaches the screenshot, so the
  run's card-to-card orders are accepted at checkout and leave the cap alone;
  only the admin spec that cuts the upload leaves one waiting, and it cancels
  that one itself. A spec that places an order only to have one cancels it in
  a `finally` with `closeOrder` (`e2e/support.ts`: a cancel with a reason,
  through the admin API), and one that means to move its order on closes it
  after the test only if it is still waiting (`closeIfStillWaiting`), as it
  is when its screenshot failed to store or the test failed first — or a
  later checkout in the run could be refused with a 422.
- **Sign in once per role, never per test.** `e2e/auth.setup.ts` signs a fresh
  customer and a fresh admin (`pnpm create-admin`) in through the real login
  page and saves their sessions, plus the customer's number
  (`customerPhone()`, for the users spec); specs opt in with
  `test.use({ storageState })` (`e2e/support.ts`). send-otp allows 3 a minute
  for the whole machine, so a run started within a minute of the last one
  waits about a minute.
- **What a run leaves in the dev database:** two throwaway `0999…` accounts,
  the 28 orders counted under «Checkout is rate-capped per account» (none left
  open: the admin spec's waiting one is cancelled by the admin, the checkout
  spec's cut one by the shopper, and the users spec's, the pager's, the
  discount's, the ordered product's, the courier one and the saved card's — accepted at
  checkout — by `closeOrder`),
  20 receipt files a run under `uploads/receipts/`, one per card-to-card
  checkout whose screenshot stored (nine per width — `checkout` 3: the
  accepted one, the retried one and the resumed one, `admin` 3: the shipped,
  the turned-down and the pager's, the cut ones storing nothing, `admin-users` 1,
  `admin-settings` 1, `courier` 1 — and `admin-catalog`'s two at 1280px; receipts are
  append-only, so nothing deletes them), one inactive `e2e-…` product with no
  photo, kept for the order a shopper placed on it (the catalog spec's other
  product, given three photos, is deleted with its files at the end), one
  switched-off `E2E…` discount code and one
  inactive «استان آزمایشی …»
  province with the customer's address on it — those three specs run at 1280px
  only, since none of those rows can be deleted. The sub-category spec deletes
  both rows it creates, so it runs at both widths, and so does the category-photo
  spec — whose two photo files stay under `uploads/`, per width per run, since
  nothing deletes a category's replaced or removed photo. The card-to-card spec leaves a
  `checkout.payment` content row equal to the default (it puts the old values
  back in a `finally`). The shipping-rate, headline and featured-box
  specs put the old value back, the two home-categories specs save the block
  again from a tab they left untouched (the API has no read, and this restores the
  picks' order too — on a fresh database it leaves a `home.categories` row
  equal to the default), the one-fee-for-all spec puts every province's
  own fee back (through the API, all attempted before any failure is reported), the province spec switches its province
  off, and the catalog spec deletes its photo product and switches its ordered
  one off (through the API), even when they fail.
- **Leaked active test products break shelf pagination.** Shelves list
  in-stock products first, then newest-first, 12 a page, so a stray active `test-…`/`e2e-…` product pushes a
  seeded one to a later page and a spec that looks for it on page one fails.
  The seed's sweep switches off any not updated for an hour.
- **Leaked top-level test categories crowd the home strip.** It shows the
  first six by sort order, then title, and a killed integration run leaves its
  «دسته آزمایشی …» category at sort order 0 with nothing to switch it off. The
  category-photo spec survives them because its «آزمون عکس …» title sorts first
  under the dev database's `en_US.utf8` collation. Its own leftovers can still
  crowd it out: a run killed or timed out mid-spec leaves its «آزمون عکس …»
  row, and with six of those beside it the new tile misses the strip whenever
  its random id sorts last among them — one run in seven, more with every
  further leftover. Delete them.
- **Uploaded images never count as failed requests.** A dev database keeps the
  uploads it was given while `.env` pointed at object storage, and this run's
  local driver has no file for them. The catalog spec proves the upload path
  instead: it uploads a photo and checks that it renders.
- **Selectors are the `data-umami-event` names** (roles for headings and
  dialogs). The loading skeletons, which nothing taps, carry a `data-testid`
  instead: `streaming.spec.ts` searches the raw HTML for it, the page's RSC
  payload included, where it must not be confused with another label. App
  routes come from `paths.ts`, and the product and province a spec uses from
  the seed data in `src/db/seed/`, never restated. Renaming an event is a spec
  change.
- **Browser: the installed Google Chrome** (`channel: 'chrome'`), no download.
  A failure keeps its trace and screenshot: `pnpm exec playwright show-report`.

## Not covered

**Not covered — still walked by hand when a story touches them:** content
areas other than the home headline, the featured boxes and the home categories,
a wrong or resent login code, maintenance
mode switched on (the suite pins it off; the gate is unit-tested in
`src/app/(app)/(store)/layout.test.ts`), Zarinpal switched off at checkout (the
suite pins it on; the disabled option is component-tested in
`src/features/checkout/checkout-form.submit.test.tsx`), analytics switched on
(the suite blanks Umami, so the tracker never mounts; its mount is unit-tested
in `src/app/layout.test.ts` and the tracker in
`src/components/umami-tracker.test.tsx`) — walk a tracked link with the real
tracker loaded and check it still swaps the page in place — the bucket refusing
an anonymous listing, which is what keeps receipts unlisted (the suite runs the
local driver; `pnpm verify-s3` checks the live bucket, docs/DEPLOY.md §3), a checkout whose answer is lost followed
by a reload that resends the same order (the client's resend is
component-tested in `src/features/checkout/checkout-form.key.test.tsx`, the
server's replay in `src/logic/checkout/create-order.idempotency.integration.test.ts`),
an add pressed between the product page's hydration commit and the cart
drawer's subscription (a window one task wide, which no ordinary step lands in;
the drawer still opening is component-tested in
`src/features/storefront/cart/cart-drawer.early-open.test.tsx`)
— and anything visual (RTL layout, Persian font rendering).
