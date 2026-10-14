# Attributions — bundled photography

Every image in `public/` is committed to this repo and served from our own
origin. Nothing here is hotlinked: Unsplash and other external hosts are slow or
unreachable from Iranian IPs, and the local-first decision in `Smokey Shop Info`
rules them out. The one bundled font, Vazirmatn, keeps its copyright notice and
SIL OFL 1.1 licence in `src/assets/fonts/OFL.txt`, beside the file that
`src/lib/fonts.ts` loads.

## Photos

Placeholder photography from [Unsplash](https://unsplash.com), used under the
[Unsplash licence](https://unsplash.com/license), downloaded on 2026-08-29.
These are stand-ins: real product photography replaces the `products/` set via
admin upload (`Story - Admin Product Management`).

### `public/products/` — seed catalog imagery

| File | Source |
| --- | --- |
| `cat-dry-food.jpg` | https://unsplash.com/photos/photo-1615789591457-74a63395c990 |
| `cat-supplement.jpg` | https://unsplash.com/photos/photo-1543852786-1cf6624b9987 |
| `cat-toy.jpg` | https://unsplash.com/photos/photo-1545249390-6bdfa286032f |
| `cat-treats.jpg` | https://unsplash.com/photos/photo-1601758228041-f3b2795255f1 |
| `cat-wet-food.jpg` | https://unsplash.com/photos/photo-1574158622682-e40e69881006 |
| `dog-dry-food.jpg` | https://unsplash.com/photos/photo-1587300003388-59208cc962cb |
| `dog-treats.jpg` | https://unsplash.com/photos/photo-1561037404-61cd46aa615b |

### `public/site/` — editorial imagery

The eight named-pet files below were created from photographs supplied by the
shop owner and edited with OpenAI image generation on 2026-09-10. They are
bundled first-party assets rather than stock photography. The portraits and
earlier heroes are WebP; the centered hero revision is an optimized JPEG.
The two heroes keep their native 1672px width — they render `fill` with
`sizes="100vw"` as the page's LCP element, so a smaller source would be
upscaled. The portraits are capped at 1200px: they render at 384-640px, and
`next/image` re-encodes per request, so beyond that a larger source only costs
repo weight.

| File | Subject / source |
| --- | --- |
| `smokey-hero.webp` | Smokey — owner-supplied photo, identity-preserving editorial edit |
| `smokey-hero-v3.webp` | Smokey — second owner-supplied reference, identity-preserving campaign edit |
| `smokey-hero-v4.jpg` | Smokey — centered composition revision of the identity-preserving campaign edit |
| `smokey-v2.webp` | Smokey — second owner-supplied reference, identity-preserving portrait edit |
| `khepelo.webp` | Khepelo — owner-supplied photo, identity-preserving portrait edit |
| `fiuna.webp` | Fiuna — owner-supplied photo, identity-preserving portrait edit |
| `melis.webp` | Melis — owner-supplied photo, identity-preserving portrait edit |
| `lili.webp` | Lili — owner-supplied photo, identity-preserving portrait edit |
| `sansa.webp` | Sansa — owner-supplied photo, identity-preserving portrait edit |

Stock photography the demo catalog seed uses (the hygiene category's tile):

| File | Source |
| --- | --- |
| `cat-hygiene.jpg` | https://unsplash.com/photos/photo-1548802673-380ab8ebc7b7 |

Legacy stock stand-ins retained for existing stored content values:

| File | Source |
| --- | --- |
| `community-baron.jpg` | https://unsplash.com/photos/photo-1568640347023-a616a30bc3bd |
| `community-luna.jpg` | https://unsplash.com/photos/photo-1514888286974-6c03e2ca1dba |
| `community-misha.jpg` | https://unsplash.com/photos/photo-1606214174585-fe31582dc6ee |
| `hero-about.jpg` | https://unsplash.com/photos/photo-1516750105099-4b8a83e217ee |
| `hero-home.jpg` | https://unsplash.com/photos/photo-1518020382113-a7e8fc38eac9 |
