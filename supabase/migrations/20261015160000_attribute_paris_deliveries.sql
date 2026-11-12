-- Owner-approved: attribute George (Oct 14) and Bryan Wandera (Oct 15) sales + their deliveries to Paris.
-- Only seller_id / delivered_by change. Runs without auth.uid(), so actor triggers leave values as set.
do $$
declare
  v_paris constant uuid := 'aca877ee-fa13-4342-bbf5-80c084df58df';
  v_ids constant uuid[] := array['b22f0979-327a-4ebb-bc0a-4d63fcfad140','f0e4a92c-6e28-434b-9ce2-758db82384a8']::uuid[];
  stock_before text; stock_after text; adj_before bigint; adj_after bigint; snap_before text; snap_after text; n int;
begin
  select md5(string_agg(category_id||':'||stock, ',' order by category_id)) into stock_before from public.inventory;
  select count(*) into adj_before from public.inventory_adjustments;
  select md5(string_agg(id||items::text||total_ugx||is_credit||credit_cleared||coalesce(amount_paid_ugx,0)||created_at, ',' order by id)) into snap_before from public.sales where id = any(v_ids);
  update public.sales set seller_id = v_paris where id = any(v_ids);
  get diagnostics n = row_count; if n <> 2 then raise exception 'expected 2 sales, got %', n; end if;
  update public.deliveries set delivered_by = v_paris where sale_id = any(v_ids);
  get diagnostics n = row_count; if n <> 2 then raise exception 'expected 2 deliveries, got %', n; end if;
  select md5(string_agg(category_id||':'||stock, ',' order by category_id)) into stock_after from public.inventory;
  select count(*) into adj_after from public.inventory_adjustments;
  select md5(string_agg(id||items::text||total_ugx||is_credit||credit_cleared||coalesce(amount_paid_ugx,0)||created_at, ',' order by id)) into snap_after from public.sales where id = any(v_ids);
  if stock_before <> stock_after or adj_before <> adj_after or snap_before <> snap_after then raise exception 'unexpected side effects'; end if;
  if exists (select 1 from public.sales where id = any(v_ids) and seller_id <> v_paris) then raise exception 'trigger overrode seller'; end if;
end $$;
