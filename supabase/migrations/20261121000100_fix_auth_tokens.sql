update auth.users
set confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change = coalesce(email_change, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    reauthentication_token = coalesce(reauthentication_token, ''),
    phone_change = coalesce(phone_change, ''),
    phone_change_token = coalesce(phone_change_token, ''),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    encrypted_password = extensions.crypt('Cosecha2027', extensions.gen_salt('bf')),
    banned_until = null,
    deleted_at = null,
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

drop policy if exists "Team can remove fondo GeoJSON" on storage.objects;
