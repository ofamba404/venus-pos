# 02 — Product spec: IA, screens, flows

Everything a staff member or admin can see or do in v2. Where a v1 behaviour is preserved, the v1 source is cited so you can read the exact logic. Where something is new, it is marked **NEW** and, if it needs owner approval, tagged with its decision number from `08-decisions.md`.

---

## 1. Principles for this product

1. **The register is the app.** Opening POS lands on Sell with tiles visible in under a second on a warm start.
2. **One way to do each thing.** One way to start a sale, one place for store orders, one place for credit.
3. **The cart is never lost.** Navigation, sheet closes, reloads and app switches never drop a cart. v1 already persists it in `sessionStorage` (`js/state.js:72-114`); v2 keeps the same keys.
4. **Staff see what staff need.** Admin-only surfaces are not shown to staff at all (no teaser links that bounce).
5. **Every write is the same as v1** unless an approved decision says otherwise.

---

## 2. Roles and access

| Route | Staff (`pos_staff`) | Admin (`pos_admin`) | v1 equivalent |
|-------|:---:|:---:|---------------|
| `/sell` (default; `/` redirects here) | ✓ | ✓ | `home` |
| `/orders` | ✓ | ✓ | header bag panel + FAB review |
| `/stock` | ✓ | ✓ | `inventory` |
| `/more` | ✓ | ✓ | hamburger menu |
| `/settings` | ✓ | ✓ | scattered (pwa, notifications) |
| `/insights` | — | ✓ | `analytics` |
| `/clients`, `/clients/:id` | — | ✓ | `clients` + analytics credit panel |
| `/history` | — | ✓ | `history` |
| `/delivery`, `/delivery/model`, `/delivery/lab` | — | ✓ | `delivery` |
| `/reviews` | — | ✓ | `reviews` |
| `/store`, `/store/users`, `/store/hours`, `/store/tools` | — | ✓ | `admin` |
| `/debug` | — | ✓ | debug overlay |
| `/system` | — | ✓ | **NEW** design-system gallery |
| `/auth` (separate entry `auth.html`) | public | public | `auth.html` |

The role rule is unchanged: staff may open exactly what v1's `STAFF_PAGES` allows (`js/auth/client.js:190-194`) plus the new non-data screens `orders` (v1 staff could already use the order panel), `more`, `settings`. A staff user who types an admin URL is redirected to `/sell` with a toast "That page is for admins." (same outcome as v1, `js/bootstrap.js:97-101`).

### Legacy URL compatibility (must work forever)

| Old URL | New behaviour |
|---------|---------------|
| `/pages/home.html` | 301 → `/sell` |
| `/pages/inventory.html` | 301 → `/stock` |
| `/pages/clients.html` | 301 → `/clients` |
| `/pages/history.html` | 301 → `/history` |
| `/pages/analytics.html` | 301 → `/insights` |
| `/pages/delivery.html` | 301 → `/delivery` |
| `/pages/reviews.html` | 301 → `/reviews` |
| `/pages/admin.html` | 301 → `/store` |
| `/#store-orders` | open `/orders` |
| `/#load-store-order=<id>` | open `/sell`, load order `<id>` into the cart (v1: `loadStoreOrderFromNotification`) |
| `/analytics#stock`, `/pages/analytics.html#stock` | `/insights#stock` |

The hash handlers must run on any route, because notifications already sitting in staff phones' trays carry these URLs (`sw.js:263-331`).

---

## 3. App shell

Mounted once in `App.tsx`. It never remounts on navigation.

### 3.1 Top bar (all screens, 56 px + safe-area top)

| Slot | Content |
|------|---------|
| Left | Venus mark (`assets/logo-badge.svg`), 28 px. On a sub-page (e.g. `/clients/:id`) it becomes a Back button |
| Centre | Screen title (Geograph 500, 17 px). On Sell: the **Today pill** instead of a title |
| Right | **Sync chip** (only when offline or writes are pending), **Orders bell** with count badge (hidden on `/orders`), **Account** avatar (initials) |

- **Today pill** (Sell only): `Today · UGX 245,000 · 18 sold`. Tap opens the Today sheet (§4.6). Data and rules from `js/home.js:updateTodayStrip` (owner-recognised revenue via `sumOwnerRevenue`, joint count, cookie count). Shows a skeleton until sales load.
- **Orders bell** count = waiting storefront orders (pending + confirmed, excluding dismissed cancelled), same as v1's `#storeOrdersBadge`. A new order pops the badge (§6 in design system) and plays the existing notification behaviour.
- **Sync chip**: `Offline` (no network) or `Saving…` (a write in flight longer than 1.5 s). Tap explains what still works.
- **Account menu** (sheet): name, email, role, Settings, Sign out.
- The bar turns opaque with a hairline after 8 px of scroll.

### 3.2 Navigation

**Phone and narrow tablet (< 960 px): bottom NavBar**, 64 px + safe-area bottom.

| Staff | Admin |
|-------|-------|
| Sell · Orders · Stock · More | Sell · Orders · Stock · Insights · More |

- Custom SVG icons (design system §5). Active tab shows a sliding ink indicator pill behind icon + label.
- Orders tab shows the same count badge as the bell.
- More tab shows a dot if there are unread reviews (admin) or an app update is ready.
- Re-tapping the active tab scrolls to top (and on Sell, collapses any open sheet).

**Wide (≥ 960 px): left Rail**, 88 px wide, same items vertically, plus admin destinations from More listed directly (Clients, History, Delivery, Reviews, Store) under a divider.

### 3.3 Overlays

- **Sheet**: bottom sheet on phone; right-side panel (480 px) on wide screens. History-backed: Android back / browser back closes it. Drag-to-dismiss only from the grab handle. Backdrop tap does **not** close sheets that hold work-in-progress (cart, config, settle, edit sale); it does close read-only sheets (Today, account).
- **Dialog**: centred, for destructive confirmations only. Buttons labelled with the action ("Void sale", "Keep sale").
- **Toast**: bottom, above the cart bar. Optional action (Undo / Retry). 4 s default, 6 s when it has an action.
- All overlays: focus trap, `aria-modal`, Escape closes, focus returns to the opener.

---

## 4. Sell (`/sell`) — the register

### 4.1 Layout

**Phone:**

```
┌ TopBar: [mark]   [Today · UGX 245,000 · 18]   [bell 2] [JM] ┐
│ Store-order strip (only if ≥1 order is loaded in the cart)    │
│ ── Joints ──────────────────────────────────────────────────  │
│ [Scout Pack 8,000] [Pilot Pack 15,000]                        │
│ [Commander's 35,000] [Variety Pack 50,000]                    │
│ [Plain 5,000/joint] [Bangis 5,000]                            │
│ ── Cookies ─────────────────────────────────────────────────  │
│ [Cookies from 5,000] [Cookie Duet 15,000]                     │
│ [Cookie Trio 21,000] [Cookie Quartet 25,000]                  │
│ [Wholesale cookies · set price]                               │
├ CartBar: [3 items  ·  UGX 45,000]            [Review sale ›] ┤
└ NavBar ──────────────────────────────────────────────────────┘
```

- One document scroll. Group headers stick under the top bar.
- Group order and tile order are **fixed**: Joints (scout, pilot, commander, variety, plain_single, spliff_single), then Cookies (cookie_single, cookie_duet, cookie_trio, cookie_quartet, cookie_wholesale). Decision D8 can swap the groups.
- 2 columns on phones, 3 at ≥ 600 px.

**Wide (≥ 960 px): two panes.** Tiles on the left (3–4 columns), the cart permanently open on the right (400 px). No CartBar.

### 4.2 Product tile

- Min height 104 px, radius per design system, raised surface.
- Content: name (title-sm), price in mono (`8,000` or `from 5,000` or `set price`), and a **flavour strip**: one 10 px dot per flavour in the product's pool, in the pool's colours (from `CAT_MAP`). Out-of-stock flavours show as hollow dots.
- Stock badge only when it matters: `Low` (amber, with icon) if every flavour in the pool is at or below `LOW_STOCK_THRESHOLD` (cookies: below `COOKIE_LOW_PCT × COOKIE_STOCK_CAPACITY`), `Out` if a pack can't be filled. Rules from `js/config.js:139-142` and `js/inventory.js`. **A badge never blocks the tap**: v1 lets staff sell regardless of draft stock (stock deducts at checkout), keep that.
- If the product is in the cart, a count chip shows in the corner (`×2`).
- Tap → Config sheet (§4.3). Press feedback: scale 0.97, 10 ms haptic.

### 4.3 Config sheet (adding a product)

Replaces v1's `config` mode (`js/orders.js` `wireProductConfigView`, `js/product-config.js`). **All rules in `js/product-config.js` must be ported unchanged**: pools, `choose_any` vs `choose_variety`, fixed flavour on Quartet, `single_qty`, `spliff_qty`, `cookie_qty`, `cookie_wholesale`, draft-stock adjustments, bulk-pricing preview.

Layout:
- Header: product name (title), price line updates live in mono (`UGX 15,000`, or for bulk-affected items `UGX 26,000 · bulk price applied`).
- **Slot meter** for packs: N segments; each filled segment takes the chosen flavour's colour. Text: `2 of 5 chosen`.
- **Flavour grid**: one chip per flavour in the pool, ≥ 56 px tall, showing swatch, flavour name, and draft stock (`12 left`). Each chip has − / + steppers once it has a count; tapping the chip body adds one. `choose_variety` rules: disable a chip with helper text when the rule forbids more of it (exact v1 rule).
- Quantity-type products (Plain, Bangis, single cookies): per-flavour steppers (Bangis: 50/50 and 70/30). For `cookie_qty`, show live bulk messaging, e.g. `4 flavoured · 6,500 each`, computed by the ported `flavored-cookie-pricing` module.
- Wholesale: unit price field (numeric keypad, UGX integer) + per-flavour quantities. Same validation as v1.
- Sticky footer: **`Add to sale · UGX 21,000`** (primary, 56 px). Disabled until the selection is valid, with a hint ("Choose 1 more").
- **Quick paths (NEW, no data change):** for `choose_any` packs, a `Same flavour ×N` shortcut row (one tap per flavour fills every slot with it). For Scout (1 slot), tapping a flavour adds to the sale immediately and closes the sheet. These just produce the same breakdown v1 would.
- Editing an existing line reopens this sheet with its breakdown and saves in place (v1 preserves state across re-renders; keep scroll and focus stable).

### 4.4 Cart

Phone: CartBar → Cart sheet (full height). Wide: always-open right pane.

**CartBar** (phone, 64 px): `3 items · UGX 45,000` + `Review sale`. Hidden when empty. When the cart holds loaded store orders, the bar shows `2 store orders` as well.

**Cart contents, top to bottom:**

1. **Cart tabs** (only when ≥ 1 storefront order is loaded): `Counter sale` + one tab per loaded order (`Amina · #A1F3`). This is v1's order switcher (`.cart-order-switcher`) and compose-parking (`js/orders.js:116-192`). Switching tabs keeps each cart intact.
2. **Store order header** (store-order tab only): customer name (POS label if set, `js/pos-labels.js`), phone and location as copy chips (v1 `data-copy`), the order's note, and **`Confirm for customer`** (sends the customer push; v1 `markStoreOrderConfirmed`). After confirming it becomes a static `Confirmed · 10:42` label. Cancelled orders show v1's cancelled banner (`store-order:cancelled` event).
3. **Lines**: flavour dots, name, breakdown text (v1 `detail`), line total in mono. Tap → edit in Config sheet. Swipe left or tap `Remove` → line removed with **Undo** toast (NEW, local only). Readonly lines for store orders follow v1's rules.
4. **Customer** (required by default — D2):
   - Field with autocomplete (v1 `js/client-autocomplete.js`), showing `owes UGX 30,000` beside clients with open credit (v1 computes this from `salesCache`).
   - **Recent clients** row (NEW): up to 6 chips for the most recent distinct clients in `salesCache`. One tap selects.
   - Typing a new name offers `Add "Name" as a new client` (v1 creates on Enter/dropdown: POST `clients`).
5. **Fulfillment**: segment `Pickup` | `Delivery`. Defaults to Pickup for counter sales; store orders default to whatever the order says. Delivery expands the v1 mini-form: pickup location (GPS button with v1's `pickupLocateGen` stale-guard), drop-off (Google Places), predicted fee (v1 `applyPredictedFee`, high end of `predictSafeBodaFeeRange`), editable fee (editing sets `fee_was_edited`), deliver-at time, phone. Store orders use `BASE_ORIGIN` as pickup (v1 rule). Google Maps loads **only** when Delivery is selected.
6. **Payment**:
   - Until D1 is approved: segment `Paid` | `On credit`. Writes exactly v1's fields (`is_credit`, `amount_paid_ugx`, `credit_cleared`, `cleared_at`).
   - With D1: `Cash` | `MTN MoMo` | `Airtel Money` | `On credit`; MoMo/Airtel show an optional `Transaction ID` field. See D1 for the data written.
   - Choosing credit for a client who already owes runs v1's stacked-debt confirmation (`js/orders.js:2410-2417`) as a Dialog: "Amina already owes UGX 30,000. Add this sale to her tab?" → `Add to tab` / `Go back`.
7. **Total block**: subtotal, delivery fee (if any), **total** (mono, 28 px, the largest number on the screen).
8. **Charge button** (64 px, sticky at the bottom of the sheet/pane): label depends on state — `Charge UGX 45,000`, `Record on credit · UGX 45,000`, `Check out order · UGX 45,000`. Disabled reasons appear as a single line above it ("Add a customer to continue"); tapping the disabled button focuses the missing field.
9. Secondary: `Hold sale` (NEW, D6) and `Clear` (with Undo).

### 4.5 Checkout and success

**Pipeline**: port `js/orders.js:2386-2578` step for step. Do not reorder writes. Summary:

1. Lock (in-flight guard; a second tap does nothing).
2. Validate (client present, config valid).
3. Resolve or create the client (v1 `resolveClientId`).
4. Stacked-credit confirmation if relevant.
5. `awaitInventoryReady`; snapshot inventory; optimistic local decrement.
6. `POST sales` with the full v1 body (see `07-parity-checklist.md §7`).
7. On success, in v1's order: `persistSoldBreakdown` deltas to `/api/inventory/write`, `deliveries` POST when delivery is on, `store_orders` PATCH `status=checked_out, sale_id` for store orders, stock-crossing notifications.
8. On failure: restore the inventory snapshot, keep the cart, show `Couldn't save the sale. Nothing was charged.` with **Retry**.

**Processing state**: the Charge button shows a spinner and `Saving…` in place. No full-screen takeover.

**Success state** (in the same sheet/pane, replaces the cart):
- The signature moment: the Charge button contracts into an ink check ring that draws in 420 ms, with a 15 ms haptic. Input is never blocked during it.
- Total (display serif, 32 px), method (`Paid` / `On credit` / method name), client, item list, delivery summary (v1 shows "Saving delivery…" while the deliveries POST is pending; keep).
- Actions: **`New sale`** (primary, auto-focused), `Send receipt on WhatsApp` (D3; only if a phone number exists), and for store orders `Next store order` (v1 `#checkoutSuccessNextStoreBtn`).
- Tapping `New sale` or closing the sheet clears to an empty counter cart (v1 behaviour).

### 4.6 Today sheet (from the Today pill)

- Owner-recognised revenue today, joints sold, cookies sold (v1 `updateTodayStrip`).
- Last 5 sales today (time, client, total, Paid/Credit tag).
- Admin only: `Open Insights` link. Staff never see links to admin pages.

### 4.7 Hold sale (NEW, D6 — local only, no backend)

- `Hold sale` stores the current counter cart (lines + meta) under a name (defaults to the client name, else `Held 10:42`) in IndexedDB `venus-pos` store `held` (new object store; bump the IDB version and migrate without touching `cache`).
- Held sales appear as a `Held (2)` chip at the top of Sell. Tap → list → `Resume` (replaces the current cart only if it is empty; otherwise asks "Hold the current sale first?").
- Held sales are per-device and never leave the device. Store orders cannot be held (they already persist server-side).

---

## 5. Orders (`/orders`) — one hub for storefront orders

Replaces v1's header bag panel, FAB review button and the order stack (`js/store-orders.js`).

### 5.1 Store status card (top)

- Shows open/closed and busy state from `store_fulfillment` (`js/fulfillment.js`): `Open until 22:00`, or `Busy until 14:30 · orders queue for later`.
- Quick actions: `Busy 30 min`, `Busy 1 h`, `Set time…` (the hours dial from `js/hours-dial.js`), and `Clear busy`. Same writes as v1's home hours widget (`js/hours-widget.js`).
- Any change shows a toast with **Undo** for 6 s (NEW; undo writes the previous values back). This lowers the blast radius of a mis-tap, since the storefront reads this live.
- Admins also get `Store hours…` → `/store/hours`.

### 5.2 Order list

- Segment: `Waiting (n)` (pending + confirmed) · `In sale (n)` (accepted, i.e. loaded into a cart on some device) · `Closed` (checked out today + cancelled not yet dismissed).
- Card: customer (POS label or name), age (`4 min ago`), item summary with flavour dots, subtotal in mono, `Delivery` or `Pickup` tag, delivery fee if any, phone/location copy chips.
- Actions on Waiting cards: **`Load into sale`** (primary) → navigates to `/sell` with the order loaded as a cart tab (v1 `loadStoreOrderIntoCart`, optimistic `accepted` PATCH); `Confirm` (customer push) if not yet confirmed; `Cancel order…` → Dialog "Cancel Amina's order? She'll get a notification." → `Cancel order` / `Keep order` (v1 cancel flow + push; suppress duplicate toast via `staffCancelledIds`).
- In sale cards: `Open in sale`; `Release` (v1 `releaseStoreOrderFromCart`).
- Cancelled cards: swipe or `Dismiss` (v1 PATCH `dismissed_at`).
- Live indicator: a small `Live` dot when realtime is connected, `Checking every few seconds` when on poll fallback.
- Empty state: "No store orders waiting." with the store status still visible above.

### 5.3 New-order arrival

On a new pending order (realtime or poll): badge pop on bell and Orders tab, toast `New store order from Amina · View`, and v1's push/notification behaviour unchanged (`js/notifications.js`).

---

## 6. Stock (`/stock`)

Replaces v1 Inventory page and the home stock glance.

- **Summary row** (from v1 home stock glance): joints total with low/out counts; cookies per flavour as capacity bars (capacity `COOKIE_STOCK_CAPACITY = 100`, low under 30 %). Tapping a summary filters the grid. The v1 `venus-pos-stock-highlight` session handoff is not needed; replace with a `?filter=low` query.
- **Grid** grouped Joints / Cookies. Each card: flavour swatch, name (+ sub-label e.g. `50/50`), count (mono, 28 px), state tag (`Low` / `Out`, icon + word), and steppers `−` / `+` at 56 px.
- `Set count` → keypad sheet (integer, "000" not needed; max 4 digits) → writes the delta exactly as v1's count-edit does.
- `Adjust…` → keypad sheet for a bulk delta with `Add` / `Remove` (replaces v1's hidden double-tap amount modal, `#amountModal`).
- Writes: v1 per-category queue to `/api/inventory/write`, fallback to direct PATCH on 405/502 (`js/inventory.js:112-209`). Stepper taps are optimistic and coalesced per category exactly as v1 queues them.
- Stock-crossing notifications unchanged (`notifyStockCrossing`).
- **NEW (read only):** subscribe to realtime changes on `inventory` so storefront-driven changes appear without waiting 20 s. Writes are unchanged. If realtime is unavailable, v1's stale window applies.

---

## 7. More (`/more`)

A plain list (rows 56 px, icon + label + chevron):

- Staff: Settings, Sign out.
- Admin: Clients & credit, History, Delivery, Reviews (unread dot), Store, Settings, Debug log, Design system, Sign out.

---

## 8. Settings (`/settings`)

Collects v1's scattered controls:

- **Notifications**: toggles for storefront orders, stock alerts, schedules (v1 `venus.notif.prefs.v1`, `js/notifications.js`). `Enable notifications on this device` runs v1's push subscribe (`/api/push/subscribe`). Shows current permission state.
- **Install app**: if `beforeinstallprompt` is available, an `Install` button; on iOS, a sheet with the real steps (Share → Add to Home Screen) instead of v1's `alert`.
- **App**: version and build ID, `Check for update` (v1 `reg.update()`), and when an update is waiting, `Restart to update`.
- **Account**: signed-in email, role, `Sign out` (v1 clears session and resets realtime).
- The v1 `#pwaEnableBanner` prompt on boot is replaced by a one-time inline card on Sell ("Turn on order alerts") that dismisses permanently, plus this screen.

---

## 9. Insights (`/insights`, admin)

Port every section of `js/analytics.js`, `js/analytics-chart.js`, `js/revenue.js`. Reorganise, do not drop.

- Header: period segment (v1 insight periods; persist in `sessionStorage` `venus_insight_period`).
- **Overview**: owner revenue (today / week / month per v1), sales count, credit owed (tap → `/clients?filter=owes`), top product.
- **Revenue chart** with v1 ranges (`venus_chart_range`). Custom SVG (port `analytics-chart.js`), no chart library.
- **Patterns**: sales heatmap and patterns (v1).
- **Products and flavours**: rank bars, flavour revenue, Pareto (v1).
- **Stock insights** (anchor `#stock`): rank bars, exceptions, cookie capacity (v1).
- **Cookie partner**: progress to the next 25-cookie batch, settled count, batch breakdown, `Copy batch text` (v1 `cookieBatchShareText`), `Mark batch settled` (v1 `/api/cookie-partner/settle` + local `venus-cookie-partner-settled-qty-v4`, including the baseline and corruption-sanitise logic).
- **Payment methods** (only with D1): totals per method for the period.

---

## 10. Clients & credit (`/clients`, admin)

Merges v1 Clients page and the Analytics credit panel.

- Search, filter chips `All` / `Owes`, sort by name or amount owed.
- Row: name, `owes UGX X` (if any), last sale date. Row actions: `Settle` (if owes), overflow (`Rename`, `Delete…`).
- `/clients/:id` detail: totals, open credit sales (oldest first), all sales, `Settle credit` (v1 settle modal: amount, method cash/mobile/other, note, `Full amount`, FIFO allocation across sales, writes `credit_payments` + PATCH `sales`) — port `js/settle-credit.js` exactly.
- Merge-duplicate-names behaviour from the v1 credit panel is preserved.
- Delete keeps historical sales (v1 rule) and asks: "Delete Amina? Her past sales stay in history." → `Delete client` / `Keep`.
- Virtual list for long lists (v1 `js/virtual-list.js`; threshold 48).

---

## 11. History (`/history`, admin)

- v1's tree: Today (expanded) → This week → last 4 weeks → months (`js/order-history.js`). Tags: credit, freebie/reward, delivery, store order.
- **NEW (local only):** search by client, filters `Credit` / `Delivery` / `Store orders`.
- Row → sale detail sheet with fulfilment meta (v1 `fulfillmentMetaBits`), `Edit sale` and `Void sale…` (v1 `openEditSale`, edit overlay, stock delta, void deletes sale and cascades delivery). Void uses a Dialog: "Void this sale? Stock is returned and the sale is deleted." → `Void sale` / `Keep sale`.
- **NEW (D3):** `Send receipt on WhatsApp` on the detail sheet when a phone exists.

---

## 12. Delivery (`/delivery`, admin)

Tabs: `Log` · `Fee model` · `Quote lab`. Port `js/delivery.js`, `js/delivery-fee-model.js`, `js/delivery-quote-lab.js`, `js/delivery-test-routes.js` unchanged in behaviour: trip list with edit, scatter and period premiums, quote lab preset routes from the v1 origin, test-quote tagging (`client_name = 'SafeBoda test'`), minimum fee 3,000.

## 13. Reviews (`/reviews`, admin)

v1 `js/reviews.js`: list (limit 100), stars, body, customer, refresh, realtime INSERT notification. Add an unread count (reviews newer than last visit, stored in `localStorage` `venus.reviews.seen.v1`) for the More dot. **NEW, local only.**

## 14. Store (`/store`, admin)

Tabs: `Overview` · `Storefront users` · `Hours` · `Tools`. Port `js/admin.js`:
- Users: list, set POS display name, verify, delete (Edge Function `store-auth` actions `admin_list_users`, `admin_set_pos_display_name`, `admin_set_verified`, `admin_delete_user`). Delete uses a Dialog.
- Hours: full `store_fulfillment` controls (open/close, busy, suggest window) with the hours dial.
- Tools: copy lists, links, and the other v1 tools.
- v1's admin Clients tab → link to `/clients`.

## 15. Debug (`/debug`, admin)

Port `js/debug.js`: captured console/error log (200 lines), copy log, `Recover from server` (v1 `dataStore.recoverFromServer` + reload). Capture starts at boot for admins only, as in v1.

## 16. Auth (`/auth`)

- Separate light entry (`auth.html`) so the sign-in page never loads the app bundle.
- Email + password, v1 GoTrue flow and role check (reject users without `pos_staff` / `pos_admin` with v1's message). `?next=` return.
- Fits the viewport (no scroll on a 360 × 640 screen). Venus mark, one title, two fields, one button, error line.

---

## 17. Cross-cutting behaviour

- **Offline**: IDB snapshot paints instantly; the Sync chip shows `Offline`. Selling while offline behaves exactly like v1 (the sale POST fails → rollback → Retry) unless D4 is approved.
- **Loading**: skeletons that match the final layout (no spinners on whole pages). Port v1's pending flags.
- **Errors**: every failed write shows what failed and a Retry. Never a silent failure.
- **Update available**: SW update → a quiet `Update ready · Restart` toast, never an automatic reload while a cart has lines or a sheet is open. (v1 reloads on `controllerchange`; v2 defers the reload until the cart is empty and no sheet is open.)
- **Keyboard (wide screens)**: Esc closes overlays; Enter submits focused forms; number keys work in keypads.

## 18. Copy rules

- Sentence case everywhere. No ALL CAPS except mono micro-labels defined in the design system.
- Buttons say what happens: `Charge UGX 45,000`, `Load into sale`, `Void sale`.
- Money always `UGX 45,000` in mono via `formatUGX`. Never `.00`, never `USh`.
- Errors say what failed and what to do: `Couldn't save the sale. Nothing was charged. Retry?`
- No emoji in UI. No exclamation marks.
- Strings live in `src/copy.ts` (one file) so the owner can review them in one place. Anything not already in v1 is marked `// DRAFT COPY` until the owner approves it.
