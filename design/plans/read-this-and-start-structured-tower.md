# Smokey Pet Shop — Implementation Plan

## Context
Build a complete Persian RTL ecommerce website + admin dashboard for **Smokey**, a premium pet lifestyle brand. The deliverable is a single-file React app (`src/app/App.tsx`) with state-based navigation covering all major pages and experiences described in the brief.

The experience must feel like an editorial lifestyle brand, not a generic ecommerce marketplace. RTL throughout, Persian copy, Vazirmatn typeface.

---

## Aesthetic Stance

**Stance**: Warm editorial boutique — generous whitespace, bold Persian type, asymmetric compositions, controlled moments of terracotta color.

**Fonts** (Google Fonts via `src/styles/fonts.css`):
- `Vazirmatn` — primary typeface for all Persian UI, body, headings. Excellent RTL support + Persian numerals.

**Palette** (`src/styles/theme.css`):
- `--background`: `#FAF7F2` (warm cream)
- `--foreground`: `#2A2118` (deep charcoal brown)
- `--card`: `#FFFFFF`
- `--primary`: `#2A2118`
- `--primary-foreground`: `#FAF7F2`
- `--secondary`: `#F0EBE3` (light warm)
- `--secondary-foreground`: `#2A2118`
- `--muted`: `#EDE8E0`
- `--muted-foreground`: `#7A6F65`
- `--accent`: `#C9623F` (terracotta — the brand accent)
- `--accent-foreground`: `#FFFFFF`
- `--border`: `rgba(42,33,24,0.1)`
- `--ring`: `#C9623F`
- `--radius`: `0.75rem`

---

## Architecture

Single `App.tsx` with a `page` state variable controlling which view renders. No URL routing. Cart state lifted to root.

**Pages** (rendered by switch on `page`):
1. `home` — full editorial homepage (10 sections)
2. `shop` — product listing with filters
3. `product` — product detail page
4. `about` — brand story page
5. `cart` — side drawer overlay (toggled, not a page)
6. `checkout` — multi-step form
7. `account` — customer dashboard + My Pets
8. `admin` — admin dashboard with charts, orders, products tabs

---

## Key Implementation Details

### Global Shell
- `<div dir="rtl" lang="fa">` wrapping everything
- `font-family: 'Vazirmatn', sans-serif` on body
- Sticky RTL navbar: logo right, nav links center, icons left (search, account, wishlist, cart with badge)
- Cart side drawer: slides in from right (RTL), overlay backdrop

### Homepage Sections
1. **Hero** — full-bleed editorial photo (Unsplash: cat in cozy home), oversized Persian headline `«زندگی بهتر، کنار بهترین دوستت»`, two CTAs, organic image mask with blob clip-path
2. **Shop by Life Moment** — horizontal scroll cards: وقت غذا, وقت بازی, وقت استراحت, مراقبت روزانه, بیرون از خانه — each with photo + short description
3. **Smokey Recommends** `«انتخاب‌های اسموکی»` — 4 premium product cards with image, brand, name, price, rating, wishlist heart, quick-add
4. **Personalized Journey** `«برای کی خرید می‌کنی؟»` — interactive step-through: cat/dog → age → needs → show results
5. **Featured Story** — editorial split layout, large photo, educational text, related products
6. **Shop the Routine** — visual daily timeline صبح→ظهر→عصر→شب with active stage revealing products
7. **Community** `«خانواده اسموکی»` — editorial collage of pet photos with names + quotes
8. **Categories** — bold oversized type + unexpected image cropping grid
9. **Brand Philosophy** `«ما هر چیزی را نمی‌فروشیم»` — centered emotional statement
10. **Newsletter** `«نامه‌های اسموکی»` — emotional signup with mobile/email input

### Shop Page
- Category header + editorial intro + product count + sort dropdown
- Left column: filter panel (نوع حیوان, سن, برند, قیمت, نیاز, امتیاز) with checkboxes
- Product grid (3-col desktop, 2-col tablet, 1-col mobile)
- Toggle: product grid vs need-based discovery mode

### Product Detail Page
- RTL two-column: image gallery left, info right
- Product name, brand, rating stars, price, variant selector (size/flavor), quantity, add to cart CTA
- Sticky mobile purchase bar
- Tabs: benefits «چرا این محصول؟» / ingredients / specs / reviews
- Editorial recommendation «نظر اسموکی»
- Related products carousel

### About Page
- Hero: full-bleed, `«همه‌چیز از عشق به یک گربه شروع شد»`
- Brand story narrative
- Process visual: بررسی→انتخاب→تجربه→پیشنهاد
- Meet Smokey (character section)
- Values grid

### Checkout
- Step indicator (5 steps)
- Form fields for each step
- Persian-friendly form with number inputs

### Account Dashboard
- Sidebar nav: سفارش‌ها, علاقه‌مندی‌ها, حیوانات من, آدرس‌ها, پروفایل
- My Pets: pet profile cards + add pet form with all fields from brief

### Admin Dashboard
- Separate dark sidebar navigation
- Overview: metric cards (فروش امروز, سفارش‌ها, مشتریان جدید, کم‌موجودی), «نیازمند توجه» action list
- Revenue/orders recharts AreaChart + BarChart
- Orders tab: sortable table with status badges
- Products tab: product list with edit/add actions

---

## Imagery

Use Unsplash photos for all sections:
- Hero: cozy cat home environment
- Life moments: cats/dogs in various settings
- Product images: white-background product style
- Community: lifestyle pet photos
- About: editorial warmth

Pattern: `https://images.unsplash.com/photo-{id}?w={width}&h={height}&fit=crop&auto=format`

---

## Files to Modify

| File | Change |
|------|--------|
| `src/styles/fonts.css` | Add Vazirmatn Google Fonts import |
| `src/styles/theme.css` | Update all color tokens to Smokey palette |
| `src/app/App.tsx` | Full implementation (~1200–1800 lines) |

---

## Verification

After implementation:
- Confirm RTL layout renders correctly (text right-aligned, nav flipped, breadcrumbs correct)
- Confirm Vazirmatn font loads
- Confirm page navigation state transitions work (home → shop → product → cart drawer → checkout)
- Confirm personalized journey interactive flow works
- Confirm admin tab navigation works
- Confirm recharts render in admin
- Confirm cart badge counts update on add-to-cart
