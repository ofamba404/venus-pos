# 08 — Owner decisions

The implementer must not decide these. Each has a **default** that applies until the owner answers. Record answers here with the date. Ask with a short multiple-choice question; never block a phase that doesn't depend on the answer.

| ID | Question | Default until answered | Blocks |
|----|----------|------------------------|--------|
| D1 | Record the payment method on every sale? | **No** (v1 behaviour: Paid / On credit only) | Phase 8 |
| D2 | Allow a walk-in sale with no client when paid in full? | **No** (client required, as v1) | Phase 8 |
| D3 | WhatsApp receipt button on success and history? | **Yes**, behind a flag, copy marked DRAFT | Phase 8 copy approval |
| D4 | Offline sales queue (sell with no signal, sync later)? | **No** | Phase 8 |
| D5 | End-of-day / shift close screen? | **No** (depends on D1) | — |
| D6 | Hold / park a counter sale on the device? | **Yes** (local only, no backend change) | — |
| D7 | Let staff settle credit? | **No** (admin only, as v1) | — |
| D8 | Sell screen group order | **Joints, then Cookies** (v1 list order) | — |
| D9 | Keep busy controls available to staff (now on Orders, with undo)? | **Yes** (as v1) | — |
| D10 | Evening dark theme? | **No** for v2.0 | — |
| D11 | Brand direction: store-aligned ink, paper and flavour colour (vs keep jade) | **Store-aligned** (approve at Phase 4 checkpoint) | Phase 4 |
| D12 | UI framework | **Preact + signals** on Vite + TS | Phase 1 |
| D13 | Require `pos_staff`/`pos_admin` in `/api/inventory/write` (security fix) | **Propose, don't apply** | — |
| D14 | Make the push-notify secret mandatory (needs a coordinated storefront change) | **Propose, don't apply** | — |
| D15 | Update the workspace ship rule wording once `ship.ps1` builds first | **Propose wording at Phase 1** | Phase 1 |

---

## D1 — Payment method at checkout

**Why:** v1 can't tell cash from MTN MoMo or Airtel Money, which makes reconciliation and an end-of-day count impossible. East-African POS tools record the method and, optionally, the transaction ID from the customer's SMS.

**If approved:**
- Migration (additive, nullable):
  ```sql
  alter table public.sales add column if not exists payment_method text
    check (payment_method in ('cash','mtn_momo','airtel_money','credit','other'));
  alter table public.sales add column if not exists payment_ref text;
  ```
- Sale body gains `payment_method` and `payment_ref` (MoMo/Airtel only). `On credit` still writes v1's credit fields, plus `payment_method = 'credit'`.
- Older sales stay `null` and show as "Paid (method not recorded)".
- Insights gains per-method totals; History gains a method tag.
- **Check before migrating:** does the storefront or any other code `select *` from `sales` and break on new columns? (Expected: no.) Check that RLS policies allow inserting the new columns.

## D2 — Walk-in sales

**Why:** a mandatory name slows every anonymous cash sale.

**Open question to ask the owner:** is the client name needed for anything beyond credit (rewards points, analytics, partner tracking)? If yes, keep D2 off.

**If approved:** a `Walk-in` chip in the customer field; `client_id = null` for paid sales only; credit still requires a client. Check first that `sales.client_id` allows `null` and that analytics and history handle `null` (dual-run tests must cover it).

## D3 — WhatsApp receipt

**Why:** WhatsApp is how customers in Kampala expect receipts. A `wa.me` link needs no backend and no cost.

**Behaviour:** button on success (and on History sale detail) only when a phone number exists. Opens `https://wa.me/<256…>?text=<encoded>`. Number normalisation: `07XXXXXXXX` → `2567XXXXXXXX`; leave other formats unchanged and fall back to the phone-less `https://wa.me/?text=`.

**DRAFT COPY (owner must approve):**
```
Venus — receipt
{date} {time}
{line 1 name} — UGX {line total}
{line 2 name} — UGX {line total}
Delivery — UGX {fee}            (only if delivery)
Total: UGX {total}
{Paid | On credit}
Thank you.
```

## D4 — Offline sales queue

**Why:** today a sale fails without signal; staff must retry later and remember the sale.

**If approved (larger change):**
- Migration: `alter table public.sales add column if not exists client_sale_id uuid unique;`
- An IndexedDB outbox keyed by `crypto.randomUUID()` (also the idempotency key), flushed on start, `online`, and `visibilitychange`; duplicate inserts return the existing row (`Prefer: resolution=ignore-duplicates` on `client_sale_id` or a small Postgres function — choose with the owner).
- Inventory deltas go into the outbox too (deltas only, never absolute counts).
- UI: `1 sale waiting to sync` chip; the sale shows as pending in History.
- Needs its own scenario set (offline sale, reconnect, exactly one row).

## D5 — Shift close

Requires D1. Opening float, pay-ins/outs, expected vs counted cash, per-method totals. Out of scope for v2.0 unless requested.

## D6 — Hold sale

Local IndexedDB only (`held` store). No data leaves the device. Default on.

## D13 / D14 — Security proposals

- D13: in `netlify/functions/_shared/supabase-admin.mjs` `requireStaffUser`, reject tokens whose `app_metadata.role` is not `pos_staff` or `pos_admin`. One-line change plus a function test. Low risk, but it changes a live function, so it needs approval.
- D14: make `PUSH_NOTIFY_SECRET` mandatory in `push-notify.mjs`, coordinated with a storefront release that sends it. Requires a change in `venus-store`, so it needs explicit approval and a joint deploy.

## Answers log

| Date | ID | Answer | Notes |
|------|----|--------|-------|
| | | | |
