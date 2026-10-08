-- Arreglo de seguridad dirigido (basado en el diagnóstico del 2026-10-07).
-- Las reglas RLS existentes se conservan; esto solo cierra tres huecos.

begin;

-- 1) Nadie puede darse permisos de administrador.
--    Desde la página solo se puede cambiar "is_public" del propio perfil.
revoke update on public.profiles from anon, authenticated;
grant update (is_public) on public.profiles to authenticated;
--    Y al crear un perfil, is_admin no puede venir en true.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (auth.uid() = user_id and coalesce(is_admin, false) = false);

-- 2) El nombre en historias y comentarios se toma del perfil (no se puede firmar como otra persona).
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

commit;

-- 3) Fotos: cada usuario solo sube a su propia carpeta (en transacción aparte por si el esquema storage tiene otro dueño).
begin;
drop policy if exists images_insert on storage.objects;
create policy images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
commit;
