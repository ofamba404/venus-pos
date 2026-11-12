# Parity: port, drop, or ask

Evidence is the v1 register in `legacy/`, storefront admin actions in `legacy/js/admin.js` and `supabase-functions/store-auth`, `docs/overhaul` (especially `07-parity-checklist.md`, `08-decisions.md`, and `HANDOFF.md`), and git history on this repo. A gap is listed only when v2 does not already do the job. Usage evidence is a populated mock or schema column, a settings key, a passing scenario, or a commit that added or removed the behaviour.

## Ask the owner

Do not build these until he says yes.

1. **Cookie Quartet.** v1 stopped selling it (`0735a71`). v2 still shows the tile and prices it. The dual-run catalog test and scenario S03 still allow that. Remove it from Sell, or keep it?
2. **Edit sale flavours.** Qty, add Plain, remove, payment, and customer are in the sheet. Reopening the pack flavour picker on a past sale is the rest of v1’s editor. Is the current sheet enough?
3. **Staff commission ledger.** Insights shows joint profit × 40% from `joint_cost_history` (the schedule in `20261111153700`). v1’s staff card reads `staff_commission_summary` and `staff_settlements` (per-person rate, balance, payouts). Show that ledger, or keep the 40% estimate?
4. **Busy for delivery vs pickup.** `store_fulfillment.busy_for` exists. The mock seed leaves it null. v2 always writes `both`. v1 also offers Delivery and Pickup. Split it, or keep both?
5. **Staff email password reset on the v2 sign-in page.** Storefront reset codes are on Store. Staff email recovery still lives on legacy `auth.html`. Add it to `/next` sign-in, or leave it on the legacy page until cutover?
6. **Staff stock edits.** v1 inventory is view-only for staff (`isStaffReadOnly`). v2 still lets staff change counts. Scenarios S29 and S30 sign in as staff and edit stock, so this was left as-is. Lock edits to admin?

## Port

| Gap | Evidence | v2 |
| --- | --- | --- |
| Client rename, sales stay on the same id | Owner ask; `clients.js`; S39 | Ported |
| Review display name, approve, hide, delete | `2efd607`; `reviews.js`; owner ask | Ported |
| Copy 9-digit phone and location | Owner ask; seed sale `client_phone` `0700333444` and `location_label` Kololo; order `phone_e164` | Ported on the review sheet, order cards, and the history sale sheet |
| Analytics the owner named (period rail, revenue, products, flavours, hours, clients, credit aging) | `analytics.js`; chart range key `venus_chart_range`; L4 | Ported as bars and a heatmap |
| Cookie partner server settlement | `851db69`; blob `/api/cookie-partner/settle`; mock seeds qty 262 | Ported |
| Storefront reset code | `admin_issue_reset_code`; owner ask | Ported |
| Pick which storefront account that code applies to | `admin.js` lists every account; seed has two `store_accounts` | Ported. The chip rail selects the account. Save, verify, delete, and reset use that row. Default stays the unverified account so S40 is unchanged |
| Walk-in, device hold, offline queue | D2, D6, D4 answered 2026-11-12; S48 and phase 8 | Ported |
| Bangis 50/50 hidden from the live stock grid | `3743756` removed it and said keep legacy display; category is `legacy: true`; no scenario edits `spliff5050` | Ported as a hide. Old sales can still name it. It is not a stock stepper |

## Drop

| Item | Why it is clutter |
| --- | --- |
| Cash / MoMo / Airtel on every sale | D1 answer is no. Paid and On credit stay |
| WhatsApp receipt | D3 answer is no |
| End-of-day / shift close | D5 answer is no |
| Evening dark theme | D10 default is no, and nobody has asked again |
| Insights donut and Pareto drawings | The same numbers are the flavour and product bars |
| Cookie partner swipe pager | The settled list and the open batch are the same data |
| Export users JSON, and a second “copy users” button | Admin toolbox. The account list is on Store. Copy names stays on Clients, which S39 and L4 use |
| Speed-dial FAB and the header bag | Replaced by the bottom nav and Orders (`07cbf4a`) |
| Per-item “you earn” rate table | Dropped on purpose for the minimal staff analytics (`29e16ab`) |
| Review `page_path` and the shop carousels | Storefront. POS dropped review paths in `07cbf4a`. Carousels stay on the shop (`82ca7e4`) |
| System page in More | Debug capture. Hidden unless dev or `venus-dev-ui` |
| Dead helpers already listed in `07-parity-checklist.md` §9 | Unused CSS, `animatePageEntrance`, `COOKIE_COMMISSION_UGX`, deprecated inventory writers |

## Already in v2

Selling, store orders, hours, stock counts for admins, credit settle, history, void, delivery quote, reviews list, and the legacy URL redirects are ticked in `07-parity-checklist.md`. Push subscribe and the cutover service worker stay Phase 10, as that checklist says.
