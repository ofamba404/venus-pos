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
| Orders segment | `orders-waiting` / `orders-in_sale` / `orders-closed` |
| Load order | `order-load-{id}` |
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
- Loaded order: `loaded-order-unlink` (label "Unlink") and `loaded-order-unlink-hint`; in checkout `release-store-order` and `unlink-hint`.
