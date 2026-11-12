# v1 and storefront parity

Audit of `legacy/` and the storefront admin actions the owner named, against v2 on `overhaul`. “Ported” means a cashier can do the job in `/next/`. “Partial” means the job exists but not every v1 control. “Open” means it is still legacy-only.

## Owner-named gaps

| Feature | v1 | v2 |
| --- | --- | --- |
| Cookie partner settlement from the shared blob | `revenue.js` monotonic merge | Ported. GET/POST `/api/cookie-partner/settle`. Settled cuts render as settled. Lower or duplicate qty is not applied. |
| Period chips | One rail | Ported. `1W LW 2W 1M 3M All` in one swipeable rail. |
| Revenue, product, flavour, hours, clients, credit aging | Canvas charts in `analytics.js` | Ported as CSS bars, a heatmap, and ranked lists. Not the v1 canvas/donut drawings. |
| Staff commission from `joint_cost_history` | `staff_commission_summary` view plus cost table | Ported as joint-profit × 40% using history (or the same default schedule when the table is empty). Payout ledger and per-staff rate editor stay on the view; the page does not edit rates. |
| Rename client, sales stay linked | `clients.js` PATCH name | Ported. `patchClient` keeps the id. |
| History shows customer, items, flavours | Receipt rows | Ported. |
| Edit sale: items, qty, payment, customer | Full pack configurator in `analytics.js` `openEditSale` | Partial. Qty, remove, add Plain, paid/credit/cleared, and customer name are in the sheet. Reconfiguring an existing pack’s flavours still uses the Sell configurator, not this sheet. |
| Review stars, display name, approve, hide, delete | `reviews.js` | Ported. PATCH `display_name` / `status`, DELETE the row. |
| Deliver-at in Kampala | Delivery time picker | Ported. `datetime-local` stored as a Kampala instant. |
| Copy 9-digit phone | — | Ported. `localPhoneDigits` strips `256` and a leading `0`. |
| Copy location | — | Ported on the review sheet and on order cards that have `location_label`. |
| Place dropdown only while typing | `places-autocomplete.js` | Ported. |
| Hide System | Debug page | Ported behind dev / `venus-dev-ui`. |
| Password recovery key | `admin_issue_reset_code` in store-auth | Ported on Store. One-time code, not stored in the POS. POS staff email reset remains the Supabase recovery link on `auth.html`. |

## Rest of v1

| Area | Status |
| --- | --- |
| Sell packs, flavours, bulk cookie price, walk-in, hold, charge, credit warning | Ported |
| Offline outbox and stock shortfall confirm | Ported |
| Store orders: load, claim, cancel, dismiss, labels | Ported |
| Stock counts and low stock | Ported |
| Delivery quote, GPS origin, fee override | Ported |
| Delivery quote lab presets | Ported on Delivery |
| Hours, busy, storefront user name / verify / delete | Ported on Store |
| Client credit settle, FIFO, cash / mobile money | Ported |
| Void sale and stock return | Ported |
| Notifications prefs | Partial. Toggles save. Push subscribe stays on the legacy service worker until Phase 10. |
| Staff analytics “my sales” and payout history | Open. Commission figure is the joint-profit share above. The `staff_commission_summary` balance and `staff_settlements` list are not a separate screen. |
| Cookie partner swipe pager and per-batch share card | Partial. Settled cuts and the open batch are a list. Share text still copies on settle. |
| Edit-sale flavour configurator and “add any product” | Partial. See above. |
| Insights donut, pareto, and prior-period sentence | Partial. Bars and heatmap cover the numbers. v1’s conic charts are not redrawn. |
| Admin search across every storefront account | Partial. Store edits the unverified account, or the first account, matching the previous v2 screen, and can now issue a reset code. |
| POS password email recovery | Open on the v2 auth page. Legacy `auth.html#type=recovery` still handles the emailed link. |
| Legacy hash routes | Ported via `legacyTarget` redirects. |

## Storefront (shop-venus.com)

Customer shop flows (browse, cart, rewards, checkout) stay on the shop. The POS only takes the admin jobs: orders, reviews, hours, account name, verification, delete, and reset code. Those are on Orders, Reviews, and Store.
