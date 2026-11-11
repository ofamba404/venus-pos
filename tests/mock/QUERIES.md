# Mock backend — request shapes used by v1

Captured from `js/` at `v1-baseline`. The mock must recognise every shape; unknown off-origin requests fail the test.

## Supabase REST (`${SUPABASE_URL}/rest/v1/…`)

| Table | Method | Path / query (representative) | Prefer / Accept | Source |
|-------|--------|-------------------------------|-----------------|--------|
| inventory | GET | `inventory?select=category_id,stock` | — | `store/repository.js` |
| inventory | PATCH | `inventory?category_id=eq.<id>` | return=representation | `inventory.js` |
| inventory | POST | `inventory` | return=representation | `inventory.js` |
| inventory | GET | `inventory?category_id=eq.<id>&select=…` | — | `inventory.js` read-after-write |
| clients | GET | `clients?select=id,name,created_at&order=name.asc` | — | `repository.js` |
| clients | POST | `clients` | return=representation | `clients.js` |
| clients | PATCH | `clients?id=eq.<uuid>` | return=representation | `clients.js` |
| clients | DELETE | `clients?id=eq.<uuid>` | return=representation | `clients.js` / `api.js` sbDelete |
| sales | GET | `sales?select=*&order=created_at.desc&limit=2000` | — | `repository.js` |
| sales | GET | `sales?select=…&created_at=gte.…` (second fetch window) | — | `repository.js` |
| sales | POST | `sales` | return=representation | `orders.js` checkout |
| sales | PATCH | `sales?id=eq.<uuid>` | return=representation | settle-credit, analytics edit |
| sales | DELETE | `sales?id=eq.<uuid>` | return=representation | analytics void |
| credit_payments | POST | `credit_payments` | return=representation | `settle-credit.js` |
| deliveries | GET | select list in repository | — | `repository.js` |
| deliveries | POST | `deliveries` | return=representation | `orders.js`, quote lab |
| deliveries | PATCH | `deliveries?id=eq.<uuid>` | return=representation | `delivery.js` |
| deliveries | DELETE | `deliveries?id=eq.<uuid>` | return=representation | void cascade / delivery.js |
| store_orders | GET | filter by status, select items + delivery fields | — | `store-orders.js` |
| store_orders | PATCH | `store_orders?id=eq.<id>` | return=representation | accept/confirm/cancel/checkout/dismiss |
| store_reviews | GET | `store_reviews?select=id,created_at,rating,body,customer_name&order=created_at.desc&limit=100` | — | `reviews.js` |
| store_fulfillment | GET | `store_fulfillment?id=eq.default&select=*` | — | `fulfillment.js` |
| store_fulfillment | PATCH | `store_fulfillment?id=eq.default` | return=representation | `fulfillment.js` |

## Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/v1/token?grant_type=password` | email/password → session |
| POST | `/auth/v1/token?grant_type=refresh_token` | refresh |
| GET | `/auth/v1/user` | current user |
| POST | `/auth/v1/logout` | 204 |

JWT payload (unsigned OK) must include `app_metadata.role` = `pos_admin` \| `pos_staff`.

## Edge / Netlify / external

| Method | URL | Source |
|--------|-----|--------|
| POST | `${SUPABASE_URL}/functions/v1/store-auth` | `admin.js`, `pos-labels.js` |
| POST | `/api/inventory/write` | `inventory.js` |
| POST | `/api/cookie-partner/settle` | `revenue.js` |
| POST | `/api/push/subscribe` | `notifications.js` |
| POST | `/api/push/unsubscribe` | `notifications.js` |
| POST | `/api/push/notify` | (server / tests) |
| POST | `https://venus-store.netlify.app/api/push/notify` | `store-orders.js` |
| GET | `https://maps.googleapis.com/maps/api/js?…` | `places-autocomplete.js` |
| * | CDN supabase-js (jsdelivr/unpkg) | abort → force poll fallback |
| * | Realtime websocket | close → force poll fallback |
| GET | Google Fonts | empty stylesheet |

## Notes

- PostgREST filters observed: `eq`, `gte`, `lte`, `order`, `limit`, `select`, embeds `store_accounts(pos_display_name)`.
- Prefer headers: `return=representation`, `return=minimal`.
- Expand this file if a golden recording hits an unrecognised shape.
