create extension if not exists pgcrypto;

update auth.users
set encrypted_password = extensions.crypt('Cosecha2027', extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where lower(email) = 'admin@agbsmart.com';

insert into public.app_profiles (id, email, full_name, role, enabled)
select u.id, lower(u.email), 'Administrador', 'admin', true
from auth.users u
where lower(u.email) = 'admin@agbsmart.com'
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name,
    role = 'admin',
    enabled = true,
    updated_at = now();

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_profiles (id, email, full_name, role, enabled)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when lower(coalesce(new.email, '')) = 'admin@agbsmart.com' then 'admin'
      else 'supervisor'
    end,
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when excluded.full_name <> '' then excluded.full_name
        else public.app_profiles.full_name
      end,
      role = case
        when lower(excluded.email) = 'admin@agbsmart.com' then 'admin'
        else public.app_profiles.role
      end,
      enabled = true,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_auth_user_created();

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_profiles
    where id = auth.uid() and enabled
  );
$$;

create or replace function public.is_team_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_profiles
    where id = auth.uid() and enabled and role = 'admin'
  );
$$;

create or replace function public.has_team_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_team_member();
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.app_profiles
  where id = auth.uid() and enabled;
$$;

drop table if exists public.team_members cascade;

alter table public.app_profiles enable row level security;

drop policy if exists "Users can read their profile" on public.app_profiles;
drop policy if exists "Admins can update profiles" on public.app_profiles;
drop policy if exists "Managed users can read fundos" on public.fundos;
drop policy if exists "Managed users can read fundo versions" on public.fundo_versions;
drop policy if exists "Managed users can read lot assignments" on public.lot_assignments;
drop policy if exists "Team can read fundos" on public.fundos;
drop policy if exists "Team can read fundo versions" on public.fundo_versions;
drop policy if exists "Team can read lot assignments" on public.lot_assignments;

drop policy if exists "Managed users can read GeoJSON" on storage.objects;
drop policy if exists "Only admins can upload GeoJSON" on storage.objects;
drop policy if exists "Only admins can remove registered GeoJSON" on storage.objects;
drop policy if exists "Team can read fundo GeoJSON" on storage.objects;
drop policy if exists "Team can upload fundo GeoJSON" on storage.objects;
drop policy if exists "Team can remove fundo GeoJSON" on storage.objects;

create policy "Users can read their profile"
on public.app_profiles for select to authenticated
using (id = auth.uid() or public.is_team_admin());

create policy "Admins can update profiles"
on public.app_profiles for update to authenticated
using (public.is_team_admin())
with check (public.is_team_admin());

create policy "Managed users can read fundos"
on public.fundos for select to authenticated
using (public.is_team_member());

create policy "Managed users can read fundo versions"
on public.fundo_versions for select to authenticated
using (public.is_team_member());

create policy "Managed users can read lot assignments"
on public.lot_assignments for select to authenticated
using (public.is_team_member());

create policy "Managed users can read GeoJSON"
on storage.objects for select to authenticated
using (bucket_id = 'fundo-geojson' and public.is_team_member());

create policy "Only admins can upload GeoJSON"
on storage.objects for insert to authenticated
with check (bucket_id = 'fundo-geojson' and public.is_team_admin());

create policy "Only admins can remove GeoJSON"
on storage.objects for delete to authenticated
using (bucket_id = 'fundo-geojson' and public.is_team_admin());

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_team_admin() from public, anon;
revoke all on function public.has_team_access() from public, anon;
revoke all on function public.current_app_role() from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_team_admin() to authenticated;
grant execute on function public.has_team_access() to authenticated;
grant execute on function public.current_app_role() to authenticated;

grant select on public.app_profiles to authenticated;
grant update on public.app_profiles to authenticated;
