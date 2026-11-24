create extension if not exists pgcrypto;

create table if not exists public.app_profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null unique,
    full_name text not null default '',
    role text not null default 'supervisor' check (
        role in ('admin', 'supervisor')
    ),
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
  constraint_name text;
begin
  select tc.constraint_name
  into constraint_name
  from information_schema.table_constraints tc
  where tc.table_schema = 'public'
    and tc.table_name = 'app_profiles'
    and tc.constraint_type = 'FOREIGN KEY'
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.app_profiles drop constraint %I',
      constraint_name
    );
  end if;

  alter table public.app_profiles
  add constraint app_profiles_id_fkey
  foreign key (id)
  references auth.users (id)
  on delete cascade;

  delete from public.app_profiles profile
  where not exists (
    select 1
    from auth.users u
    where u.id = profile.id
  );
end;
$$;

alter table public.app_profiles enable row level security;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_profiles (
    id,
    email,
    full_name,
    role,
    enabled
  )
  values (
    new.id,
    coalesce(lower(new.email), ''),
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

create or replace function public.register_fundo_version(
  p_fundo_id text,
  p_name text,
  p_version_id uuid,
  p_file_name text,
  p_storage_path text,
  p_assignments jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_admin() then
    raise exception 'Solo el administrador puede agregar o versionar GeoJSON.';
  end if;
  if p_storage_path not like p_fundo_id || '/' || p_version_id::text || '/%' then
    raise exception 'La ruta de almacenamiento no corresponde a esta versión.';
  end if;

  insert into public.fundos (id, name, created_by)
  values (p_fundo_id, trim(p_name), auth.uid())
  on conflict (id) do update set name = excluded.name;

  insert into public.fundo_versions (id, fundo_id, file_name, storage_path, uploaded_by)
  values (p_version_id, p_fundo_id, p_file_name, p_storage_path, auth.uid());

  update public.fundos
  set current_version_id = p_version_id
  where id = p_fundo_id;

  if coalesce(jsonb_typeof(p_assignments), '') = 'array' then
    insert into public.lot_assignments (fundo_id, lot_uid, supervisor, color, updated_by)
    select p_fundo_id, item ->> 'lot_uid', item ->> 'supervisor', item ->> 'color', auth.uid()
    from jsonb_array_elements(p_assignments) as assignments(item)
    where nullif(trim(item ->> 'lot_uid'), '') is not null
      and nullif(trim(item ->> 'supervisor'), '') is not null
      and nullif(trim(item ->> 'color'), '') is not null
    on conflict (fundo_id, lot_uid) do update
    set supervisor = excluded.supervisor,
        color = excluded.color,
        updated_by = excluded.updated_by,
        updated_at = now();
  end if;
end;
$$;

drop policy if exists "Team members can read their own membership" on public.team_members;

drop policy if exists "Admins can manage team membership" on public.team_members;

drop table if exists public.team_members;

drop policy if exists "Team can read fundos" on public.fundos;

drop policy if exists "Team can read fundo versions" on public.fundo_versions;

drop policy if exists "Team can read lot assignments" on public.lot_assignments;

drop policy if exists "Team can read fundo GeoJSON" on storage.objects;

drop policy if exists "Team can upload fundo GeoJSON" on storage.objects;

drop policy if exists "Team can remove fundo GeoJSON" on storage.objects;

drop policy if exists "Users can read their profile" on public.app_profiles;

drop policy if exists "Admins can update profiles" on public.app_profiles;

drop policy if exists "Managed users can read fundos" on public.fundos;

drop policy if exists "Managed users can read fundo versions" on public.fundo_versions;

drop policy if exists "Managed users can read lot assignments" on public.lot_assignments;

drop policy if exists "Managed users can read GeoJSON" on storage.objects;

drop policy if exists "Only admins can upload GeoJSON" on storage.objects;

drop policy if exists "Only admins can remove registered GeoJSON" on storage.objects;

create policy "Users can read their profile" on public.app_profiles for
select to authenticated using (
        id = auth.uid ()
        or public.is_team_admin ()
    );

create policy "Admins can update profiles" on public.app_profiles for
update to authenticated using (public.is_team_admin ())
with
    check (public.is_team_admin ());

grant select on public.app_profiles to authenticated;

grant update on public.app_profiles to authenticated;

create policy "Managed users can read fundos" on public.fundos for
select to authenticated using (public.is_team_member ());

create policy "Managed users can read fundo versions" on public.fundo_versions for
select to authenticated using (public.is_team_member ());

create policy "Managed users can read lot assignments" on public.lot_assignments for
select to authenticated using (public.is_team_member ());

create policy "Managed users can read GeoJSON" on storage.objects for
select to authenticated using (
        bucket_id = 'fundo-geojson'
        and public.is_team_member ()
    );

create policy "Only admins can upload GeoJSON" on storage.objects for
insert
    to authenticated
with
    check (
        bucket_id = 'fundo-geojson'
        and public.is_team_admin ()
    );

create policy "Only admins can remove registered GeoJSON" on storage.objects for delete to authenticated using (
    bucket_id = 'fundo-geojson'
    and public.is_team_admin ()
    and not exists (
        select 1
        from public.fundo_versions
        where
            storage_path = storage.objects.name
    )
);

revoke all on function public.current_app_role() from public, anon;

grant execute on function public.current_app_role () to authenticated;