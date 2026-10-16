-- Ajustes de la app que controla el admin (por ejemplo, quién ve el modo podcast).
-- Todos pueden leerlos; solo una cuenta con is_admin = true puede cambiarlos.
begin;

create table if not exists public.app_settings (
  key text primary key check (length(key) between 1 and 60),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.app_settings enable row level security;

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = auth.uid()), false)
$$;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to anon, authenticated using (true);
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings for insert to authenticated with check (public.is_app_admin());
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;

create or replace function public.app_settings_stamp() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists app_settings_stamp on public.app_settings;
create trigger app_settings_stamp before insert or update on public.app_settings for each row execute function public.app_settings_stamp();

-- valor inicial: el modo podcast lo ve todo el mundo (como hoy)
insert into public.app_settings(key, value) values ('podcast', '{"mode":"all","users":[]}'::jsonb)
  on conflict (key) do nothing;

commit;
