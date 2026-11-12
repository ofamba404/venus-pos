-- Staff display names: data-driven (auth user_metadata.display_name), not derived from email.
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', 'Paris')
 where id = 'aca877ee-fa13-4342-bbf5-80c084df58df';

drop function if exists public.pos_staff_directory();
create function public.pos_staff_directory()
returns table (user_id uuid, email text, role text, display_name text)
language sql security definer set search_path = public, auth stable as $$
  select u.id, u.email::text, u.raw_app_meta_data ->> 'role',
         coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email::text, '@', 1))
    from auth.users u
   where public.is_pos_admin()
     and u.raw_app_meta_data ->> 'role' in ('pos_admin', 'pos_staff');
$$;
revoke all on function public.pos_staff_directory() from public, anon;
grant execute on function public.pos_staff_directory() to authenticated;
