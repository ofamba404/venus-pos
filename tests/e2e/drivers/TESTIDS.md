# Next driver `data-testid` map

Use these on v2 elements. Drivers resolve via `[data-testid="…"]`.

| Intent | Test id |
| --- | --- |
| Product tile | `product-{id}` (e.g. `product-scout`) |
| Config flavour stepper −/+ | `config-flavor-{id}-dec` / `config-flavor-{id}-inc` |
| Config qty stepper | `config-qty-dec` / `config-qty-inc` |
| Add to sale | `config-add` |
| Cart bar | `cart-bar` |
| Cart line remove | `cart-remove-{key}` |
| Client field | `cart-client` |
| Client chip | `client-chip-{id}` |
| Payment segment | `pay-paid` / `pay-credit` |
| Charge | `charge` |
| Delivery fee field | `delivery-fee` |
| Place search | `place-search` / `place-input` / `place-option` |
| Today pill | `today-pill` |
| Stock −/+ | `stock-{id}-dec` / `stock-{id}-inc` |
| Stock qty (opens set count) | `stock-{id}-qty` |
| Set count keypad confirm | `stock-set-confirm` |
| Nav | `nav-sell` / `nav-orders` / `nav-stock` / `nav-more` |
| Orders segment | `orders-waiting` / `orders-closed` (no In sale tab) |
| View order (opens the store order sheet) | `view-order-{id}` |
| Settle credit amount | `settle-amount` |
| Settle confirm | `settle-confirm` |
| Person row / sheet | `person-{clientId or accountId}` / `person-sheet` |
| Clients filter chips | `client-filter-{all,walkin,storefront,owes}` |
| Storefront account actions | `store-user-name` / `-save` / `-verify` / `-reset` / `-delete` / `-delete-confirm` |
| Client delete | `client-delete` then `client-delete-confirm` |
| Add item (History edit) | `sale-edit-add`, `sale-add-catalog`, `sale-add-apply` |
| Cookie partner page | `cookie-partner-page`, `partner-hero`, `partner-progress`, `partner-settle`, `partner-confirm`, `partner-confirm-send`, `partner-confirm-cancel`, `partner-history`, `partner-batch-{n}` |
| Insights partner tile | `partner-summary` |

## Insights (v2c/v2d)

- Money chart: `money-chart`, `money-totals` (hero), `money-profit` and `money-sales` (`data-value`), `money-plot` (`data-unit`), `money-bar` (`data-sales`, `data-profit`), `money-readout` (empty until a bar is tapped), `money-split`, `money-owner`, `money-helper`.
- Restock: `insights-restock`, `restock-headline`, `restock-row-{id}`, `restock-qty-{id}` (plain text), `restock-key`, `restock-fine-toggle`, `restock-fine-line`, `restock-fine-list`, `copy-restock`.
- Credit: `insights-credit`, `credit-headline`, `credit-toggle`, `credit-settled`, `credit-age-bar`, `credit-legend`, `credit-person-{key}`, `credit-whatsapp-{key}`, `credit-phone-{key}`, `credit-orders-{key}`, `credit-settle-order-{id}`, `credit-settle-all-{key}`, `credit-settle-sheet`, `credit-settle-amount`, `credit-settle-confirm`.
- Store orders never enter the cart. The old loaded-order card, Unlink, `release-store-order` and Load into sale are gone (see v2j).

## v2f (sheets, history, hours, gallery)

- Sheets: `v-sheet` gains `is-closing` for 480ms while closing; scrim likewise. Reduced motion unmounts at once.
- Orders: `status-{id}` tags on Closed cards (Cancelled, Completed, Closed), `orders-{waiting,closed}` carry counts.
- History: week and day accordion toggles (`history-week-toggle-{key}`, `history-day-toggle-{key}`), owed rows (`history-owed*`). Open a day before asserting a sale row (`tests/e2e/helpers/history.ts`).
- Insights: no helper until a start day is set. `helper-add` (quiet row) with `helper-add-open`, then `helper-since-input` and `helper-add-cancel`. With a start day: `commission-ledger`, `helper-since-input`, `helper-since-clear`. Tests that need the helper call `withHelper(page)` (`tests/e2e/helpers/helper.ts`); restock card verbs Roll N (joints) and Order N (cookies); `copy-restock` has Roll and Order sections.
- Cookie partner: `partner-batch-toggle-{n}` opens `partner-batch-detail-{n}`, showing the batch lines.
- Hours page: `hours-page`, `store-status` (`data-state` open, closed or busy), `busy-15` / `busy-30` / `busy-60` / `busy-clear`, `hours-open`, `hours-close`, `hours-suggest-start`, `hours-suggest-end`, `hours-preview`, `hours-save`.
- Gallery: `line-gallery` (cart line), `edit-line-gallery` (sale edit), `order-gallery` (order card), `history-gallery` (History row), each with `data-slides`; `gallery-track`, dots with `data-dot` (cart and edit lines only; order card and History dots are pictures). Sell tiles have no gallery. `line-qty` appears only for a quantity above one (muted ×N beside the line name); a pack shows none. The cart body renders twice (aside and Review sale dialog), so scope to the dialog.

## v2i (real-data fixes)
- Time picker (our own sheet, no native time input): chips `hours-open`, `hours-close`, `hours-suggest-start`, `hours-suggest-end`; sheet `clock-sheet`, wheels `clock-hour-{1..12}`, `clock-minute-{0,15,30,45}`, `clock-ampm-{am,pm}`, `clock-readout`, `clock-cancel`, `clock-clear`, `clock-done`. Test helper: `tests/e2e/helpers/clock.ts` (`setClock`, `pickOnWheels`).
- Busy: `busy-15` / `busy-30` / `busy-60`, `busy-custom` (opens the same wheels as "Busy until"), `busy-active`, `busy-remaining`, `busy-clear`.
- Cookie partner: tapping a sent batch (`partner-batch-toggle-N`) loads it into `partner-hero` (`data-viewing=N`, `partner-hero-kicker`, `partner-hero-dates`); `partner-back` returns. No accordion.
- Galleries loop with clones (`data-gallery-clone`); real slides carry `data-gallery-index`. The ×N badge is `gallery-qty`, outside the photo viewport; dots sit below the tile.
- Orders: cards are photo | name+price over tags | items inline | one action row (primary, Copy all, Cancel).

## v2j (cart and store order sheet are different drawers)
- Cart ("Review sale", `cart-bar`): walk-in sales only. No store-order card on Sell, no Unlink, no loaded order. A `storeOrderId` left in session storage by an older build is dropped on load.
- Orders card: `order-card-{id}` (tap opens the sheet), primary `view-order-{id}` ("View order"; Confirm `confirm-order-{id}` takes the primary slot while the order is pending), `confirmed-{id}` tag (also for accepted orders), `cancel-order-{id}`.
- Store order sheet (dialog "Store order", read only): `store-order-sheet` (`data-mode` delivery or pickup), `store-order-name`, `store-order-items` (rows reuse `.v-cart-line`, gallery `so-gallery`), `so-place` / `so-phone` / `so-when` with `-value` text (phone: `so-phone-cc` is "+256", `so-phone-value` the national number, `so-phone-box` the whole box) and `so-copy-place` / `so-copy-phone`, `so-distance`, `store-order-fee` (the only input; delivery only), `store-order-total` (`data-total` = items only; the delivery fee is paid separately to the rider), `store-order-pay`, `store-order-confirm`, `store-order-confirmed`, `store-order-checkout`, `store-order-cancel` (two taps).
- Link: `/next/orders#order=<id>` opens the sheet (push notifications use it; `#load-store-order=<id>` still opens it).
- Contract driver: `loadStoreOrder` opens the sheet; `charge`, `chargeRetry`, `doubleTapCharge` press `store-order-checkout` while it is open; `setClient` is a no-op there; `confirmStoreOrder` presses `store-order-confirm`; the S27 deep link and its `cartLines` count are read from the sheet's items.
- Cookie partner bar: flavoured squares carry `data-flavor`, legend `partner-legend`.
