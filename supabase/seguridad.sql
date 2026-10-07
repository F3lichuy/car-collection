-- =====================================================================
--  Car Collection · Reglas de seguridad para Supabase (Row Level Security)
--
--  Cómo usarlo:
--    1. Entra a supabase.com → tu proyecto → SQL Editor.
--    2. Corre primero la PARTE 1 (solo lectura) y revisa qué reglas tienes hoy.
--    3. Si estás de acuerdo, corre la PARTE 2. Es idempotente: se puede correr varias veces.
--    4. Prueba la página (iniciar sesión, agregar coche, publicar historia, comentar, dar like).
--
--  Qué protege:
--    - Nadie puede editar o borrar datos de otra persona (garages, historias, comentarios, likes).
--    - Solo administradores (profiles.is_admin = true) pueden borrar del catálogo.
--    - Un usuario no puede darse permisos de administrador a sí mismo.
--    - Los garages privados no se pueden leer desde fuera.
--    - Las fotos solo se suben a la carpeta propia de cada usuario.
--    - Límites de tamaño para textos (evita spam y abusos).
-- =====================================================================


-- ---------------------------------------------------------------------
-- PARTE 1 · Diagnóstico (no cambia nada)
-- ---------------------------------------------------------------------
select tablename, rowsecurity as rls_activo
from pg_tables where schemaname = 'public' order by tablename;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public','storage') order by tablename, policyname;


-- ---------------------------------------------------------------------
-- PARTE 2 · Reglas
-- ---------------------------------------------------------------------
begin;

-- ¿El usuario actual es administrador? (security definer: lee profiles sin depender de sus reglas)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- profiles ----------
alter table public.profiles enable row level security;
alter table public.profiles add column if not exists is_admin boolean not null default false;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check (user_id = auth.uid() and is_admin = false);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- is_admin no se puede cambiar desde la página: solo is_public es editable
revoke update on public.profiles from anon, authenticated;
grant update (is_public) on public.profiles to authenticated;

-- ---------- garages ----------
alter table public.garages enable row level security;
drop policy if exists "garages_select" on public.garages;
drop policy if exists "garages_write_own" on public.garages;
drop policy if exists "garages_update_own" on public.garages;
drop policy if exists "garages_delete_own" on public.garages;
create policy "garages_select" on public.garages for select using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = garages.user_id and p.is_public)
);
create policy "garages_write_own" on public.garages for insert to authenticated with check (user_id = auth.uid());
create policy "garages_update_own" on public.garages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "garages_delete_own" on public.garages for delete to authenticated using (user_id = auth.uid());

-- ---------- catalog (colaborativo: cualquiera con sesión agrega versiones; solo admin borra) ----------
alter table public.catalog enable row level security;
drop policy if exists "catalog_select" on public.catalog;
drop policy if exists "catalog_insert" on public.catalog;
drop policy if exists "catalog_update" on public.catalog;
drop policy if exists "catalog_delete_admin" on public.catalog;
create policy "catalog_select" on public.catalog for select using (true);
create policy "catalog_insert" on public.catalog for insert to authenticated with check (added_by = auth.uid());
create policy "catalog_update" on public.catalog for update to authenticated using (true) with check (added_by = auth.uid() or public.is_admin());
create policy "catalog_delete_admin" on public.catalog for delete to authenticated using (public.is_admin());

-- ---------- stories ----------
alter table public.stories enable row level security;
drop policy if exists "stories_select" on public.stories;
drop policy if exists "stories_insert_own" on public.stories;
drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_select" on public.stories for select using (true);
create policy "stories_insert_own" on public.stories for insert to authenticated with check (user_id = auth.uid());
create policy "stories_delete_own" on public.stories for delete to authenticated using (user_id = auth.uid() or public.is_admin());
alter table public.stories drop constraint if exists stories_len;
alter table public.stories add constraint stories_len check (char_length(coalesce(title,'')) <= 160 and char_length(coalesce(body,'')) <= 12000) not valid;

-- ---------- comments ----------
alter table public.comments enable row level security;
drop policy if exists "comments_select" on public.comments;
drop policy if exists "comments_insert_own" on public.comments;
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_select" on public.comments for select using (true);
create policy "comments_insert_own" on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy "comments_delete_own" on public.comments for delete to authenticated using (user_id = auth.uid() or public.is_admin());
alter table public.comments drop constraint if exists comments_len;
alter table public.comments add constraint comments_len check (char_length(coalesce(body,'')) <= 2000) not valid;

-- El nombre de usuario de historias y comentarios se toma del perfil (no se puede falsificar)
create or replace function public.stamp_username() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.username := (select p.username from public.profiles p where p.user_id = auth.uid());
  return new;
end $$;
drop trigger if exists stories_stamp_username on public.stories;
create trigger stories_stamp_username before insert on public.stories for each row execute function public.stamp_username();
drop trigger if exists comments_stamp_username on public.comments;
create trigger comments_stamp_username before insert on public.comments for each row execute function public.stamp_username();

-- ---------- likes ----------
alter table public.likes enable row level security;
drop policy if exists "likes_select" on public.likes;
drop policy if exists "likes_insert_own" on public.likes;
drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_select" on public.likes for select using (true);
create policy "likes_insert_own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes_delete_own" on public.likes for delete to authenticated using (user_id = auth.uid());

-- ---------- follows ----------
alter table public.follows enable row level security;
drop policy if exists "follows_select_own" on public.follows;
drop policy if exists "follows_insert_own" on public.follows;
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_select_own" on public.follows for select to authenticated using (follower_id = auth.uid() or following_id = auth.uid());
create policy "follows_insert_own" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "follows_delete_own" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- ---------- shared_categories (solo si la tabla existe) ----------
do $$ begin
  if to_regclass('public.shared_categories') is not null then
    execute 'alter table public.shared_categories enable row level security';
    execute 'drop policy if exists "shcat_select" on public.shared_categories';
    execute 'drop policy if exists "shcat_insert" on public.shared_categories';
    execute 'create policy "shcat_select" on public.shared_categories for select using (true)';
    execute 'create policy "shcat_insert" on public.shared_categories for insert to authenticated with check (created_by = auth.uid())';
  end if;
end $$;

-- ---------- storage: bucket "images" ----------
drop policy if exists "images_read" on storage.objects;
drop policy if exists "images_upload_own_folder" on storage.objects;
drop policy if exists "images_delete_own" on storage.objects;
create policy "images_read" on storage.objects for select using (bucket_id = 'images');
create policy "images_upload_own_folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

commit;

-- Para darte permisos de administrador (una sola vez, cambia el usuario si hace falta):
-- update public.profiles set is_admin = true where lower(username) = 'feli_chuy';
