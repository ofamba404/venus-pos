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

## Is this the right component?

Each flow was a restyled list row or a bare field. The question for this pass is whether that object is the right one. Where it is not, the page now uses a component built for the job.

| Flow | Was | Decision | Why |
| --- | --- | --- | --- |
| Sell | Text button with a price | `ProductCard` | A pack is a photo, a name, and a price. A label cannot tell Scout from Pilot. |
| Review / checkout | Separate fields | `DeliveryBlock` plus `TimePicker` | Drop-off, phone, fee, and time are one decision. The time control is a clock, not a text field. |
| After charge | Inline check markup | `Celebration` | The sale is finished. One amount, one sentence, one way back to the next customer. |
| Incoming order | Article of divs | `OrderCard` | Who, flavour swatches, amber total, and copy actions are the scan. Load and cancel stay as actions on the card. |
| History row | Generic list row | `HistoryRow` | A past sale is recognisable closed: person, thumb, swatches, paid or credit. |
| Edit sale | Sheet of steppers | Kept the sheet | Qty, add Plain, remove, payment, and customer are the edit. Reopening the flavour picker is still an owner question in `PARITY.md`. |
| Client | Spreadsheet row | `ClientCard` | Initial, last order, and what they owe. Edit is its own control so settling credit does not rename them. |
| Insights | Text and number lists | Charts first | An area for revenue and profit, product bars, a flavour donut, a peak-hours heatmap, a credit-aging bar, and a cookie-partner ring. KPI tiles carry a delta and a sparkline. The figures open when you tap the chart. |
| Reviews | Text block | `ReviewCard` | A quote, stars, and a verdict. Approve, hide, delete, and rename sit on the card. |
| Stock | Colour plus a number | `StockTile` | The flavour dot is the name. Low and out are tags on that tile, with the count and steppers beside it. |
| Empty lists | A blank title | `EmptyState` | Sell, orders, and reviews say what to do next when there is nothing to show. |
| Login | A centred form | Kept the auth card | Email, password, show/hide, and the reset link are already one card. It did not need a second component. |

## Product images

The twelve catalog files in `public/assets/products/` are verified byte-identical to `venus-store` `assets/images` at `0e629f9`. Sell tiles, before a flavour is chosen, use those pack photos. A Scout, Pilot, or Commander line that is one flavour uses the matching file from `assets/images/packs/` at the same commit (`scout-mint.webp`, `pilot-grape.webp`, `commanders-strawberry.webp`). Those 21 files are resized to 512px (about 111 KB together) so a 44px thumb does not decode a 3072px image. A mixed pack keeps the generic photo. Cookie duet, trio, and single flavours use the cookie photos. Plain and Bangis use their shop photos. Cookie quartet and wholesale have no catalog file, so the card shows a blank panel instead of a fake photo.

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
