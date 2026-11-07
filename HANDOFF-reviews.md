# Handoff: review moderation in the POS (branch cursor/review-moderation-fe82, PR #2)

Status as of 2026-11-07. Nothing is merged and no migration has been applied to Supabase project xiangrykfxlnacthjcad. The storefront side is venus-store PR #1, branch cursor/store-reviews-4226, which has its own HANDOFF-reviews.md.

## Done
- A Reviews page in the POS (pages/reviews.html, js/pages/reviews.js, js/reviews.js) where the owner approves or hides store reviews.
- Migration supabase/migrations/20261107120000_store_reviews_moderation.sql. It is written but not applied.

## Next: requested by the owner
1. **Delete a review.** Add a Delete action on each review with a confirm step, because it can't be undone. It needs an owner-only RLS delete policy, or an owner-checked RPC, in a new migration.
2. **Edit the customer's display name.** Make the display name editable inline on each review and save it to the review row (not the customer's account). Trim it, cap the length to match the storefront limit, and reject an empty name. It needs an owner-only update path for display_name.
- Keep approve and hide as they are. The storefront only shows approved reviews, so an edit or delete should show up there on the next load.

## Rules
Don't merge, apply migrations or deploy without the owner's explicit approval.
