create table if not exists public.user_fundo_permissions (
  user_id uuid not null references public.app_profiles(id) on delete cascade,
  fundo_id text not null references public.fundos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, fundo_id)
);

create index if not exists user_fundo_permissions_fundo_id_idx
  on public.user_fundo_permissions(fundo_id);

alter table public.user_fundo_permissions enable row level security;

create or replace function public.can_access_fundo(p_fundo_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_team_admin()
      or exists (
        select 1
        from public.user_fundo_permissions permission
        where permission.user_id = auth.uid()
          and permission.fundo_id = p_fundo_id
      );
$$;

create or replace function public.set_user_fundo_permissions(
  p_user_id uuid,
  p_fundo_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_admin() then
    raise exception 'Solo el administrador puede asignar fundos.';
  end if;

  if exists (
    select 1
    from public.app_profiles profile
    where profile.id = p_user_id
      and profile.role = 'admin'
  ) then
    delete from public.user_fundo_permissions
    where user_id = p_user_id;
    return;
  end if;

  delete from public.user_fundo_permissions
  where user_id = p_user_id;

  insert into public.user_fundo_permissions(user_id, fundo_id)
  select p_user_id, distinct_id
  from unnest(coalesce(p_fundo_ids, array[]::text[])) as distinct_id
  where exists (
    select 1
    from public.fundos fundo
    where fundo.id = distinct_id
  )
  on conflict (user_id, fundo_id) do nothing;
end;
$$;

drop policy if exists "Managed users can read fundos" on public.fundos;
create policy "Managed users can read assigned fundos" on public.fundos
for select to authenticated
using (public.can_access_fundo(id));

drop policy if exists "Managed users can read fundo versions" on public.fundo_versions;
create policy "Managed users can read assigned fundo versions" on public.fundo_versions
for select to authenticated
using (public.can_access_fundo(fundo_id));

drop policy if exists "Managed users can read lot assignments" on public.lot_assignments;
create policy "Managed users can read assigned lot assignments" on public.lot_assignments
for select to authenticated
using (public.can_access_fundo(fundo_id));

drop policy if exists "Admins can manage fundo permissions" on public.user_fundo_permissions;
create policy "Admins can manage fundo permissions" on public.user_fundo_permissions
for all to authenticated
using (public.is_team_admin())
with check (public.is_team_admin());

drop policy if exists "Managed users can read GeoJSON" on storage.objects;
create policy "Managed users can read assigned fundo GeoJSON" on storage.objects
for select to authenticated
using (
  bucket_id = 'fundo-geojson'
  and public.can_access_fundo(split_part(name, '/', 1))
);

grant select, insert, update, delete on public.user_fundo_permissions to authenticated;
revoke all on function public.can_access_fundo(text) from public, anon;
revoke all on function public.set_user_fundo_permissions(uuid, text[]) from public, anon;
grant execute on function public.can_access_fundo(text) to authenticated;
grant execute on function public.set_user_fundo_permissions(uuid, text[]) to authenticated;

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

    if target_fundo_id is null or not public.can_access_fundo(target_fundo_id) then
      raise exception 'No tienes permiso para modificar este fundo.';
    end if;

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

revoke all on function public.save_lot_assignments(jsonb) from public, anon;
grant execute on function public.save_lot_assignments(jsonb) to authenticated;
