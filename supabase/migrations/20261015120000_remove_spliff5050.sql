-- Bangis 50/50 (spliff5050) discontinued.
-- inventory row has 0 stock and no FKs -> removed (inventory-write no longer accepts the id).
-- joint_costs row is KEPT: 6 historical sales have spliff5050 lines and the commission/profit
-- view needs the cost to classify them as joints. No store_product_prices / products rows exist.
delete from public.inventory where category_id = 'spliff5050' and stock = 0;
comment on table public.joint_costs is 'Per-joint cost by category. spliff5050 is discontinued; row kept for historical sales reporting.';
