insert into storage.buckets (id, name, public)
values ('fundo-geojson', 'fundo-geojson', false)
on conflict (id) do update set public = false;

create table public.team_members (
  email text primary key,
  role text not null default 'editor' check (role in ('admin', 'editor')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fundos (
  id text primary key,
  name text not null,
  current_version_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.fundo_versions (
  id uuid primary key,
  fundo_id text not null references public.fundos(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.fundos
  add constraint fundos_current_version_fk
  foreign key (current_version_id) references public.fundo_versions(id);

create table public.lot_assignments (
  fundo_id text not null references public.fundos(id) on delete cascade,
  lot_uid text not null,
  supervisor text not null,
  color text not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (fundo_id, lot_uid)
);

create index fundo_versions_fundo_id_created_at_idx
  on public.fundo_versions (fundo_id, created_at desc);

alter table public.team_members enable row level security;
alter table public.fundos enable row level security;
alter table public.fundo_versions enable row level security;
alter table public.lot_assignments enable row level security;

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where enabled
      and lower(email) = lower(auth.jwt() ->> 'email')
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
    from public.team_members
    where enabled
      and role = 'admin'
      and lower(email) = lower(auth.jwt() ->> 'email')
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
  if not public.is_team_member() then
    raise exception 'La cuenta no pertenece al equipo autorizado.';
  end if;
  if p_storage_path not like p_fundo_id || '/' || p_version_id::text || '/%' then
    raise exception 'La ruta de almacenamiento no corresponde a esta versión.';
  end if;
  if coalesce(jsonb_typeof(p_assignments), '') <> 'array' then
    raise exception 'Se esperaba una lista de asignaciones.';
  end if;

  insert into public.fundos (id, name, created_by)
  values (p_fundo_id, trim(p_name), auth.uid())
  on conflict (id) do update set name = excluded.name;

  insert into public.fundo_versions (id, fundo_id, file_name, storage_path, uploaded_by)
  values (p_version_id, p_fundo_id, p_file_name, p_storage_path, auth.uid());

  update public.fundos
  set current_version_id = p_version_id
  where id = p_fundo_id;

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
end;
$$;

create or replace function public.save_lot_assignments(p_assignments jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  target_fundo_id text;
  target_uid text;
  target_supervisor text;
  target_color text;
begin
  if not public.is_team_member() then
    raise exception 'La cuenta no pertenece al equipo autorizado.';
  end if;
  if coalesce(jsonb_typeof(p_assignments), '') <> 'array' then
    raise exception 'Se esperaba una lista de asignaciones.';
  end if;

  for item in select value from jsonb_array_elements(p_assignments)
  loop
    target_fundo_id := item ->> 'fundo_id';
    target_uid := item ->> 'lot_uid';
    target_supervisor := nullif(trim(item ->> 'supervisor'), '');
    target_color := nullif(trim(item ->> 'color'), '');

    if target_uid is null then
      raise exception 'Falta el identificador del lote.';
    elsif target_supervisor is null or target_color is null then
      delete from public.lot_assignments
      where fundo_id = target_fundo_id and lot_uid = target_uid;
    else
      insert into public.lot_assignments (fundo_id, lot_uid, supervisor, color, updated_by)
      values (target_fundo_id, target_uid, target_supervisor, target_color, auth.uid())
      on conflict (fundo_id, lot_uid) do update
      set supervisor = excluded.supervisor,
          color = excluded.color,
          updated_by = excluded.updated_by,
          updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_team_admin() from public, anon;
revoke all on function public.has_team_access() from public, anon;
revoke all on function public.register_fundo_version(text, text, uuid, text, text, jsonb) from public, anon;
revoke all on function public.save_lot_assignments(jsonb) from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_team_admin() to authenticated;
grant execute on function public.has_team_access() to authenticated;
grant execute on function public.register_fundo_version(text, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.save_lot_assignments(jsonb) to authenticated;

grant select, insert, update, delete on public.team_members to authenticated;
grant select on public.fundos to authenticated;
grant select on public.fundo_versions to authenticated;
grant select on public.lot_assignments to authenticated;

create policy "Team members can read their own membership"
  on public.team_members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_team_admin());
create policy "Admins can manage team membership"
  on public.team_members for all to authenticated
  using (public.is_team_admin())
  with check (public.is_team_admin());

create policy "Team can read fundos"
  on public.fundos for select to authenticated
  using (public.is_team_member());
create policy "Team can read fundo versions"
  on public.fundo_versions for select to authenticated
  using (public.is_team_member());

create policy "Team can read lot assignments"
  on public.lot_assignments for select to authenticated
  using (public.is_team_member());

create policy "Team can read fundo GeoJSON"
  on storage.objects for select to authenticated
  using (bucket_id = 'fundo-geojson' and public.is_team_member());
create policy "Team can upload fundo GeoJSON"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'fundo-geojson' and public.is_team_member());
create policy "Team can remove fondo GeoJSON"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fundo-geojson'
    and public.is_team_member()
    and not exists (
      select 1 from public.fundo_versions
      where storage_path = storage.objects.name
    )
  );
