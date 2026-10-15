-- Store order price check: accept the 6500 flavored-cookie bulk price only when the order has
-- 4+ flavored cookies in total, counted like the storefront (flavored-cookie-pricing.js):
-- flavored singles count their quantity; Duet/Trio count flavored breakdown keys (else 2/3) × quantity;
-- reward lines count 0. Otherwise the line falls through to the normal reprice-at-full-price path.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.recompute_store_order_totals'::regproc);
  if position('bulk_unit constant integer := 6500;' in d) = 0 then raise exception 'bulk_unit 6500 not found'; end if;
  n := replace(d, '  is_reward boolean;
begin', '  is_reward boolean;
  flavored_total integer := 0;
  bulk_ok boolean;
begin');
  n := replace(n, '  for item in select * from jsonb_array_elements(new.items)
  loop',
'  select coalesce(sum(
           case
             when coalesce((it->>''is_reward'')::boolean, false) or coalesce(it->>''reward_key'', '''') <> '''' then 0
             when coalesce(it->>''store_product_id'', '''') = any (flavored_ids) then greatest(coalesce((it->>''quantity'')::int, 1), 1)
             when (pack_flavored ->> coalesce(it->>''store_product_id'', '''')) is not null then
               greatest(coalesce((it->>''quantity'')::int, 1), 1) * coalesce(nullif((
                 select coalesce(sum(greatest(floor((b.value)::numeric), 0)), 0)::int
                   from jsonb_each_text(case when jsonb_typeof(it->''breakdown'') = ''object'' then it->''breakdown'' else ''{}''::jsonb end) b
                  where b.key in (''cookie_chocolate'', ''cookie_mint'', ''cookie_strawberry'') and b.value ~ ''^[0-9.]+$''), 0),
                 (pack_flavored ->> (it->>''store_product_id''))::int)
             else 0 end), 0)
    into flavored_total
    from jsonb_array_elements(new.items) it;
  bulk_ok := flavored_total >= 4;

  for item in select * from jsonb_array_elements(new.items)
  loop');
  n := replace(n, 'if not allowed and store_id = any (flavored_ids) then', 'if not allowed and bulk_ok and store_id = any (flavored_ids) then');
  n := replace(n, '    if not allowed then
      pack_flavored_n', '    if not allowed and bulk_ok then
      pack_flavored_n');
  if n = d or position('bulk_ok and store_id' in n) = 0 or position('if not allowed and bulk_ok then' in n) = 0
     or position('into flavored_total' in n) = 0 or position('flavored_total integer' in n) = 0 then
    raise exception 'function text did not match expected shape';
  end if;
  execute n;
end $$;
