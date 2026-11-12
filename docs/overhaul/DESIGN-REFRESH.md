# Design refresh

Owner feedback on `/next/` after phone use: the register felt static, grey, and unfinished. This pass keeps the existing type ramp and spacing scale, and changes shape, colour, motion, and the screens he photographed.

## Palette

Venus green is the action colour. Flavour colours come from the same set the shop uses for joints and cookies.

| Token | Hex | Use |
| --- | --- | --- |
| `--accent` | `#0b7a62` | Primary buttons, chart bars, success check |
| `--mint` | `#0f8f78` | Mint |
| `--melon` | `#ef7d1a` | Melon, star ratings |
| `--grape` | `#6d4ea3` | Grape, avatars |
| `--blueberry` | `#3156c9` | Blueberry |
| `--watermelon` | `#e23b4a` | Watermelon, heatmap |
| `--strawberry` | `#d81e2c` | Strawberry |
| `--coconut` | `#5f8f6a` | Coconut |
| `--plain` | `#c4a574` | Plain |
| `--mint-tint` `--melon-tint` `--grape-tint` `--berry-tint` | tints | Stat cards and product tiles |

Paper, ink, and danger stay as they were. Cards are tinted, not a second grey panel on beige.

## Type

Unchanged scale: Geograph for UI, Self Modern for display, Akkurat Mono for money. Stat amounts use the title size so a UGX figure stays on one line inside a half-width card. Section labels stay the 11px uppercase meta style.

## Radii and targets

- `--r-pill` (999px) on primary, secondary, ghost, and danger buttons, segmented controls, period chips, tags, avatars, and the cart bar.
- `--r-lg` (20px) on cards, tiles, and sheets.
- `--r-md` (12px) on fields.
- Tap targets stay at least 44px. Buttons use the 48px hit size. Segment buttons are 44px.

## Motion

Durations live on `--d-instant` through `--d-slow`. `prefers-reduced-motion: reduce` collapses those durations and turns off page, list, success, and skeleton animation.

- Page enter: 8px rise.
- Sheets already slide. Buttons scale to 0.97 on press.
- The first eight list rows, order cards, and review cards stagger by 30ms.
- A completed sale pops the check.
- Chart bars ease their height. Skeleton bars shimmer while orders load.

## Components touched

Pills and tints: `Button`, `Segmented`, chips, tags, stat cards, product tiles, cart bar.

New or extended: flavour dots on history and order lines, storefront photos on Sell tiles and order/history thumbs, client avatar rows, review cards, insight bars and heatmap, copy actions for phone and location.

## Product images

Photos are the shop-venus.com storefront assets, saved under `public/assets/products/` so the register does not depend on the shop being online. Scout uses the mint joint photo. Cookie packs use the duet, trio, and cookie photos. Plain and Bangis use their shop photos.

## Gap list this pass closes

- One swipeable period rail. The old Week / Month / All row is not rendered.
- Insights copy is labels and charts, not bucket dumps.
- Cookie partner reads `/api/cookie-partner/settle` and paints server cuts as settled. A lower write is refused. The settle button waits for `res.ok` and a qty that did not go backwards.
- Clients: pill Add, avatar, owed, last order, rename, no hash id. Clear sits inside the row.
- History rows name the customer and show items with flavour dots and a thumb. Edit sale changes qty, adds or removes a line, payment status, and customer.
- Reviews are cards with stars, display-name edit, approve, hide, and delete.
- Deliver-at is a Kampala datetime picker. Phone copy is 9 local digits. Location copy is on the review sheet and on order cards that have a drop-off. The fee line says “Delivery est.”
- Place suggestions open only while the cashier is typing, and close on select or blur.
- System stays off the More menu unless the Vite dev server is running or `localStorage.venus-dev-ui` is `1`.
- Store can issue a one-time customer reset code.

What is still short of v1 is listed in `PARITY.md`.
