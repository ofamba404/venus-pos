# Handoff: review moderation in the POS (branch cursor/review-moderation-fe82, PR #2)

Status as of 2026-11-07. LIVE as of 2026-11-07 ~19:00 EAT: both migrations applied to xiangrykfxlnacthjcad, branch merged to master, POS deployed to production (owner approved). The storefront side is venus-store PR #1, branch cursor/store-reviews-4226, which has its own HANDOFF-reviews.md.

## Done
- A Reviews page in the POS (pages/reviews.html, js/pages/reviews.js, js/reviews.js) where the owner approves or hides store reviews.
- Migration supabase/migrations/20261107120000_store_reviews_moderation.sql. It is written but not applied.

## Done on 2026-11-07: delete and rename (code only; the migration is NOT applied)
- **Delete:** each review has a Delete button for the owner only. It opens a confirm ("…This can't be undone.", button "Delete"), then sends a DELETE. The row is dropped from the list and the counts refresh. Realtime DELETE events also remove the row on other open POS tabs.
- **Display name edit:** owner only. Tap the name (✎) to edit it inline, then Save or Enter to keep it, or Cancel or Esc to discard. The name is trimmed and spaces are collapsed. It's capped at 40 characters (`maxlength` plus a check), the same as the storefront form and the DB check. An empty name is rejected with a toast. Saving PATCHes `display_name` on the review row only; the customer's account is untouched.
- Approve and hide are unchanged. Staff still see a read-only list (no Delete, no edit).
- **New migration, not applied:** supabase/migrations/20261107190000_store_reviews_owner_delete_rename.sql. Apply it after 20261107120000.
  - Grants DELETE and adds the RLS policy `store_reviews_admin_delete`, which allows only `is_pos_admin()`.
  - Grants UPDATE (display_name).
  - Replaces `private.store_reviews_guard()` so that an admin UPDATE may change display_name. It enforces trim, collapse and 1–40 characters, and syncs customer_name. Every other column is still pinned.
- Until both migrations are applied, Delete and rename fail with "Could not delete/save" toasts on live, because RLS/grants block them.
- The storefront only lists approved rows, so a rename or delete shows up there on the next load.
- POS SW is now v109.
- Verified with a mocked owner session and mocked API, with no real reviews touched. Screenshots are in /workspace/nov07/pos-reviews-*.png on the agent box.

## Remaining
- Nothing on the POS side. The guard keeps the live storefront footer (which sends only customer_name plus account_id) working: display_name falls back to customer_name, then to 'Customer'. New reviews now arrive as pending and need Approve.

## Rules
Don't merge, apply migrations or deploy without the owner's explicit approval.
