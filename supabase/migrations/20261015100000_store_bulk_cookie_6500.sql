-- Align store-order price check with app code: flavored cookie bulk (4+) unit = 6500 (was 6250).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.recompute_store_order_totals'::regproc);
  if position('bulk_unit constant integer := 6250;' in d) = 0 then
    raise exception 'expected bulk_unit 6250 not found';
  end if;
  execute replace(d, 'bulk_unit constant integer := 6250;', 'bulk_unit constant integer := 6500;');
end $$;
