# Parity: port, drop, or ask

Evidence is the v1 register in `legacy/`, storefront admin actions in `legacy/js/admin.js` and `supabase-functions/store-auth`, `docs/overhaul` (especially `07-parity-checklist.md`, `08-decisions.md`, and `HANDOFF.md`), and git history on this repo. A gap is listed only when v2 does not already do the job. Usage evidence is a populated mock or schema column, a settings key, a passing scenario, or a commit that added or removed the behaviour.

## Decided by the owner (2026-11-12)

The five open asks were answered. Each one is built and has a test.

| # | Ask | Answer | v2 | Tests |
| --- | --- | --- | --- | --- |
| S03 | **Cookie Quartet.** v1 stopped selling it (`0735a71`). | Remove it from Sell | Gone from the Sell grid. The catalog row stays, marked `retired`, so old sales, held carts and store orders still read and can be edited. S03 now asserts the tile is absent | S03 (next and legacy), dual-run catalog |
| S36 | **Edit sale flavours.** | Reopen the flavour picker | Each line in Edit sale has **Change flavours**. It opens the same picker Sell uses, prefilled with the sale's flavours. Name, detail, breakdown and price are rebuilt like Sell builds them, and stock moves by the difference | S36, `sale-edit-flavours` unit, owner-decisions spec |
| — | **Staff commission.** | The 40% estimate, plus what has been paid | Insights, What do I owe: **owed now** = 40% of profit (`economics.ts`) on every sale minus the sum of `staff_settlements`, with Earned and Paid beside it. If payouts can't be read it says so rather than show a wrong figure | `commission` unit, owner-decisions spec |
| — | **Busy for delivery vs pickup.** | Keep one switch | One switch. Busy 30 min writes `busy_for: both`. Clear writes null. No Delivery or Pickup split | S28, owner-decisions spec |
| S29, S30 | **Staff stock edits.** | Lock to admin | Staff see counts and the low/out flags, read-only, with a note. Admin keeps the steppers and the exact count. The lock is in the UI: checkout still takes stock down for staff, so the write path is not closed | S29, S30, S31, S32, S33 sign in as admin. owner-decisions spec covers staff |

Staff email reset is no longer an ask. It is on `/next/auth.html` (show/hide password, and the recovery link back to that page).

## Port

| Gap | Evidence | v2 |
| --- | --- | --- |
| Client rename, sales stay on the same id | Owner ask; `clients.js`; S39 | Ported |
| Review display name, approve, hide, delete | `2efd607`; `reviews.js`; owner ask | Ported |
| Copy 9-digit phone and location | Owner ask; seed sale `client_phone` `0700333444` and `location_label` Kololo; order `phone_e164` | Ported as 44px tinted tap targets (mint for phone, melon for place) on the review sheet, order cards, and the history sale sheet. The icon ticks when copied |
| Analytics the owner named (period rail, revenue, products, flavours, hours, clients, credit aging) | `analytics.js`; chart range key `venus_chart_range`; L4 | Ported as bars and a heatmap |
| Cookie partner server settlement | `851db69`; blob `/api/cookie-partner/settle`; mock seeds qty 262 | Ported |
| Storefront reset code | `admin_issue_reset_code`; owner ask | Ported |
| Pick which storefront account that code applies to | `admin.js` lists every account; seed has two `store_accounts` | Ported. The chip rail selects the account. Save, verify, delete, and reset use that row. Default stays the unverified account so S40 is unchanged |
| Long customer names on order cards | Owner nit | They wrap. The amount stays put |
| Walk-in, device hold, offline queue | D2, D6, D4 answered 2026-11-12; S48 and phase 8 | Ported |
| Bangis 50/50 hidden from the live stock grid | `3743756` removed it and said keep legacy display; category is `legacy: true`; no scenario edits `spliff5050` | Ported as a hide. Old sales can still name it. It is not a stock stepper |

## Changed in v2 (owner-approved, v2c)

| Item | Decision |
| --- | --- |
| Clients and storefront users | One Clients page. POS clients (`clients`) and storefront accounts (`store_accounts`) merge into one list with All / Walk-in / Storefront / Owes chips (one row, scrolls sideways only if a count gets long). A client and an account that share the same 9-digit phone are one person with both action sets. Matching is UI-only: no DB link, no migration. The Store page no longer lists users. S40 now runs from Clients |
| Store accounts load | All of them, 200 per request until a page comes back short. It was 20 |
| Settle credit | Amount plus an optional note. The Cash / Mobile money toggle is gone. The `credit_payments` row still sends `method: 'cash'` so the schema is untouched |
| Deleting | Asks first, for a client and for a storefront account |
| Orders list card copy | One pill, Copy all. Copy phone and Copy location stay on the loaded-order card and in checkout |
| Loaded order | A confirmed order that is loaded into the sale stays in In sale. The button stays Unlink, with a short line saying the order stays in Orders, not cancelled |
| History edit sale | Add item opens Sell's product tiles and capped picker, replacing Add Plain. + on a pack adds another pack (it used to multiply the first flavour). Totals use Sell's line builder and cookie repricing |
| Cookie partner | Its own page, Cookie partner under More (`/cookie-partner`). Insights keeps a small summary tile that opens it. Partial batch send ported from v1 PR #3: a part-filled batch can be sent only while no full batch waits, after a confirm, with the server checked first and one write of a higher total. Same failure wording as v1. The write is still `POST /api/cookie-partner/settle`, unchanged |
| Insights money chart | Replaces the three profit tiles. One big profit figure with a small muted line, profit of UGX N sales. Bars are profit only (per day up to a month, then week or month), stacked You (ink) and Helper (bronze), day labels only, so the tallest bar is the most profitable day. No readout until you tap a bar, then one line with that day's profit and sales. One slim strip shows You against Helper. The cookie partner's cut and joint cost do not appear here. Insights sections now share one generous, even gap. Profit by pack stays |
| Insights restock | Headline first: Nothing to restock this cycle, or Restock N flavours. Only urgent flavours are listed, each with its `orderQty` and days left. The card verb is Roll N for joints (the owner rolls those) and Order N for cookies. Copy restock list has a Roll section and an Order section. The rest is one line (N flavours fine for 2+ weeks), expandable. Copy restock list stays. The order quantity is plain semibold text, not a pill. The bar's full length is labelled as the 2-week cycle |
| Insights credit | Replaces Who should I chase. One collapsed card (total owed, people, collected in the range) with one age bar (under 1 week, 1-2, 2-4, older). Tap for a row per person (owed age, WhatsApp reminder with the amount, Copy phone). Tap a person for their orders and settle one order or all of them, through the same `settleCredit` write the Clients page uses. There is no due date, so it says owed N days, never overdue |
| Review sale | Opens in place from Load into sale (before loading) and is Review sale everywhere after. No Review order button. Delivery orders show no pickup fields, pickup orders show no delivery fields. Copy buttons sit inline on the right of the field. Use GPS and Shop pickup are gone from delivery mode |
| Orders status | In sale and Closed cards carry a status badge; the tabs carry counts |
| History | Weeks and days are accordions (this week and the latest day open). Owed rows are grouped. Rows are collapsed by default, so tests reveal them first |
| Helper days | Sales do not record who made them, so Insights has a Helper started on date. Days before it are not counted as helper days. Unset keeps the old behaviour |
| Cookie partner batches | Each sent batch opens to its lines. The settle fetch refreshes an expired token and retries once |
| Hours & availability | Replaces Store under More (`/store`, titled Hours). Status hero (Open now, Closed, Busy), busy 15 min, 30 min, 1 hour and Clear busy, time pickers for opening hours and the suggested delivery window, a Customers see preview, Save only when changed. No storefront users, no legacy admin button |
| Pack photos | Cart and sale-edit lines show one photo per flavour with a ×N badge, dots and slow auto-advance that pauses on touch and off screen, like the storefront cart drawer. One flavour is a plain photo. Reduced motion stops auto-advance |
| Motion | Every sheet uses the storefront drawer open and close motion. Accordions (History, partner batches, credit, restock) animate. List items, toasts and segments ease in. Reduced motion turns it all off. Tap highlight is removed |

## Drop

| Item | Why it is clutter |
| --- | --- |
| Cash / MoMo / Airtel on every sale | D1 answer is no. Paid and On credit stay |
| WhatsApp receipt | D3 answer is no |
| End-of-day / shift close | D5 answer is no |
| Evening dark theme | D10 default is no, and nobody has asked again |
| Cookie Quartet on Sell | Owner decision, S03 | Removed. See above |
| Insights donut and Pareto drawings | The same numbers are the flavour and product bars |
| Cookie partner swipe pager | The settled list and the open batch are the same data |
| Export users JSON, and a second “copy users” button | Admin toolbox. Copy names stays on Clients, which S39 and L4 use |
| Speed-dial FAB and the header bag | Replaced by the bottom nav and Orders (`07cbf4a`) |
| Per-item “you earn” rate table | Dropped on purpose for the minimal staff analytics (`29e16ab`) |
| Review `page_path` and the shop carousels | Storefront. POS dropped review paths in `07cbf4a`. Carousels stay on the shop (`82ca7e4`) |
| System page in More | Debug capture. Hidden unless dev or `venus-dev-ui` |
| Dead helpers already listed in `07-parity-checklist.md` §9 | Unused CSS, `animatePageEntrance`, `COOKIE_COMMISSION_UGX`, deprecated inventory writers |

## Already in v2

Selling, store orders, hours, stock counts for admins (read-only for staff), credit settle, history, void, delivery quote, reviews list, and the legacy URL redirects are ticked in `07-parity-checklist.md`. Push subscribe and the cutover service worker stay Phase 10, as that checklist says.
